import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { ccc } from "@ckb-ccc/core";
import { pilotWalletLock, PILOT_PASSKEY_CODE_HASH, PILOT_WALLET_GENERAL_CODE_HASH,
  PILOT_WALLET_SESSION_CODE_HASH, PILOT_TYPE_ID, type PilotWalletDescriptor } from "@owl/pilot";
const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, {alias: {"@": process.cwd()}});
const { profileHistoryAddresses, profileHistoryAddressScope, profileHistoryAddressRegex, isProfileHistoryScript } =
  jiti("../lib/profileHistoryIdentity.ts") as typeof import("../lib/profileHistoryIdentity.ts");
const { getAddressNetDeltaShannons } = jiti("../lib/txBalanceDelta.ts") as typeof import("../lib/txBalanceDelta.ts");
const h = (byte: string) => `0x${byte.repeat(32)}` as ccc.Hex;
const ownerLock = ccc.Script.from({codeHash: PILOT_PASSKEY_CODE_HASH, hashType: "data2", args: `0x${"22".repeat(97)}`});
const foreignLock = ccc.Script.from({...ownerLock, args: `0x${"33".repeat(97)}`});
function spendingLock(seed: string, codeHash = PILOT_WALLET_GENERAL_CODE_HASH, owner: ccc.Script = ownerLock) {
  const descriptor: PilotWalletDescriptor = {version: 2,
    deployment: {network: "testnet", genesisHash: h("aa"), codeHash, outPoint: {txHash: h("bb"), index: 0}},
    ownerLock: owner, stateType: {codeHash: PILOT_TYPE_ID, hashType: "type", args: h(seed)},
    poolLock: {codeHash: h("44"), hashType: "type", args: "0x"}, maxFee: "100000"};
  return pilotWalletLock(descriptor);
}

test("history discovery finds historical and current sessions on either network without an active wallet", async () => {
  for (const client of [new ccc.ClientPublicTestnet(), new ccc.ClientPublicMainnet()]) {
    const address = ccc.Address.fromScript(ownerLock, client).toString();
    const accounts = [spendingLock("11"), spendingLock("99"), spendingLock("aa", PILOT_WALLET_SESSION_CODE_HASH)];
    const candidates = accounts.map(lock => ccc.Address.fromScript(lock, client).toString());
    const addresses = await profileHistoryAddresses(address, client, async lookup => {
      candidates.forEach(value => assert.ok(lookup.test(value), "prefix query must discover each account"));
      return [...candidates, candidates[0].toUpperCase(), address];
    });
    assert.deepEqual(new Set(addresses), new Set([address, ...candidates]));
    const match = profileHistoryAddressRegex(addresses);
    addresses.forEach(value => assert.ok(match.test(value.toUpperCase())));
    assert.equal(match.test(`${candidates[0]}extra`), false);
    assert.equal(match.test(ccc.Address.fromScript(foreignLock, client).toString()), false);
  }
});

test("history aliases reject foreign owners, wrong scripts, malformed addresses and partial owner commitments", async () => {
  const client = new ccc.ClientPublicTestnet();
  const address = ccc.Address.fromScript(ownerLock, client).toString();
  const valid = spendingLock("11");
  const alteredHash = ccc.bytesFrom(valid.args); alteredHash[31] ^= 1;
  const wrong = [spendingLock("11", PILOT_WALLET_GENERAL_CODE_HASH, foreignLock),
    ccc.Script.from({...valid, codeHash: h("88")}), ccc.Script.from({...valid, hashType: "type"}),
    ccc.Script.from({...valid, args: valid.args.slice(0, -2)}), ccc.Script.from({...valid, args: ccc.hexFrom(alteredHash)}),
    ccc.Script.from({...valid, args: `0x${ownerLock.args.slice(2, 66)}${"00".repeat(72)}`})];
  wrong.forEach(script => assert.equal(isProfileHistoryScript(ownerLock, script), false));
  const scope = await profileHistoryAddressScope(address, client);
  assert.ok(scope.lookup.source.length > 100);
  const found = await profileHistoryAddresses(address, client, async () => ["bad address", null,
    ...wrong.map(script => ccc.Address.fromScript(script, client).toString())]);
  assert.deepEqual(found, [address]);
});

test("ordinary wallets keep their exact history scope and skip Pilot address discovery", async () => {
  const client = new ccc.ClientPublicTestnet();
  const joy = ccc.Script.from({...await client.getKnownScript(ccc.KnownScript.JoyId), args: `0x${"55".repeat(22)}`});
  const address = ccc.Address.fromScript(joy, client).toString();
  assert.deepEqual(await profileHistoryAddresses(address, client, async () => {throw new Error("must not query aliases");}), [address]);
  assert.equal(isProfileHistoryScript(joy, ccc.Script.from({...spendingLock("11"), args: `${joy.hash()}${"00".repeat(72)}`})), false);
});

function transactionClient(inputs: {lock: ccc.Script; capacity: bigint}[], outputs: {lock: ccc.Script; capacity: bigint}[], missing = false) {
  return {addressPrefix: "ckt", getTransaction: async () => ({transaction: {
    inputs: inputs.map((output, i) => ({getCell: async () => missing && i === 0 ? null : {cellOutput: ccc.CellOutput.from(output)}})),
    outputs: outputs.map(output => ccc.CellOutput.from(output)),
  }})} as unknown as ccc.Client;
}

test("transaction deltas include all owner-bound spending accounts, exclude sponsors and count internal transfers once", async () => {
  const client = transactionClient([{lock: ownerLock, capacity: 500n}, {lock: spendingLock("11"), capacity: 1000n},
    {lock: foreignLock, capacity: 200n}], [{lock: ownerLock, capacity: 200n}, {lock: spendingLock("11"), capacity: 800n},
    {lock: spendingLock("99"), capacity: 400n}, {lock: foreignLock, capacity: 300n}]);
  const address = ccc.Address.fromScript(ownerLock, client).toString();
  assert.equal(await getAddressNetDeltaShannons(h("77"), address, client), "-100");
  assert.equal(await getAddressNetDeltaShannons(h("77"), [address, address, ccc.Address.fromScript(spendingLock("11"), client).toString()], client), "-100");
});

test("missing historical inputs produce an unknown delta rather than a misleading zero or credit", async () => {
  const client = transactionClient([{lock: ownerLock, capacity: 500n}], [{lock: spendingLock("11"), capacity: 300n}], true);
  const address = ccc.Address.fromScript(ownerLock, client).toString();
  assert.equal(await getAddressNetDeltaShannons(h("77"), address, client), null);
});
