import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { ccc } from "@ckb-ccc/core";
import { pilotWalletLock, PILOT_PASSKEY_CODE_HASH, PILOT_WALLET_GENERAL_CODE_HASH, PILOT_WALLET_SESSION_CODE_HASH,
  PILOT_TYPE_ID, type PilotWalletDescriptor } from "@owl/pilot";
const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, {alias: {"@": process.cwd()}});
const { verifyFreightTreeCreator } = jiti("../lib/freightTreeCreator.ts") as typeof import("../lib/freightTreeCreator.ts");
const client = new ccc.ClientPublicTestnet();
const h = (byte: string) => `0x${byte.repeat(32)}` as ccc.Hex;
const ownerLock = ccc.Script.from({codeHash: PILOT_PASSKEY_CODE_HASH, hashType: "data2", args: `0x${"22".repeat(97)}`});
const owner = ccc.Address.fromScript(ownerLock, client).toString();
function fixture(codeHash = PILOT_WALLET_GENERAL_CODE_HASH, seed = "11") {
  const descriptor: PilotWalletDescriptor = {version: 2,
    deployment: {network: "testnet", genesisHash: h("aa"), codeHash, outPoint: {txHash: h("bb"), index: 0}},
    ownerLock, stateType: {codeHash: PILOT_TYPE_ID, hashType: "type", args: h(seed)},
    poolLock: {codeHash: h("44"), hashType: "type", args: "0x"}, maxFee: "100000"};
  const spendingLock = pilotWalletLock(descriptor);
  const createdByHash = spendingLock.args.slice(0, 42);
  const row = {campaignId: `${createdByHash}:1234:4`, createdByHash, chainCreatedAt: "1234", campaignType: 4,
    creatorAddress: owner, txHash: h("cc")};
  const publication = {eventKey: `freight-create:${row.txHash}`, address: owner, metadata: {campaignId: row.campaignId}};
  return {row, publication, spendingAddress: ccc.Address.fromScript(spendingLock, client).toString()};
}

test("tree ownership resolves Pilot owner profiles across general and session accounts", async () => {
  for (const codeHash of [PILOT_WALLET_GENERAL_CODE_HASH, PILOT_WALLET_SESSION_CODE_HASH]) {
    for (const seed of ["11", "33"]) {
      const {row, publication, spendingAddress} = fixture(codeHash, seed);
      assert.notEqual(owner, spendingAddress);
      assert.equal(await verifyFreightTreeCreator(client, row, [publication]), owner);
      assert.equal(await verifyFreightTreeCreator(client, {...row, creatorAddress: spendingAddress}, [publication]), owner);
      assert.equal(row.createdByHash, ccc.hexFrom(ccc.bytesFrom(ownerLock.hash()).slice(0, 20)));
    }
  }
});

test("a profile hash match requires the verified receipt for this exact publication and freight", async () => {
  const {row, publication} = fixture();
  for (const publications of [[], [{...publication, eventKey: `freight-create:${h("dd")}`}],
    [{...publication, metadata: {campaignId: `${row.createdByHash}:9999:4`}}]]) {
    await assert.rejects(verifyFreightTreeCreator(client, row, publications), /does not match its on-chain identity/);
  }
  const stranger = ccc.Address.fromScript({...ownerLock, args: `0x${"77".repeat(97)}`}, client).toString();
  await assert.rejects(verifyFreightTreeCreator(client, row, [{...publication, address: stranger}]), /does not match its on-chain identity/);
});

test("tree ownership rejects inconsistent stable IDs even when a publication event matches the claimed ID", async () => {
  const {row, publication} = fixture();
  await assert.rejects(verifyFreightTreeCreator(client, {...row, chainCreatedAt: "9999"}, [publication]), /identity is incomplete/);
});

test("ordinary JoyID-style creator identities still use lock arguments without a Pilot receipt", async () => {
  const script = ccc.Script.from({...await client.getKnownScript(ccc.KnownScript.JoyId), args: `0x${"55".repeat(22)}`});
  const creatorAddress = ccc.Address.fromScript(script, client).toString();
  const createdByHash = script.args.slice(0, 42);
  const row = {campaignId: `${createdByHash}:1234:4`, createdByHash, chainCreatedAt: "1234", campaignType: 4, creatorAddress};
  assert.equal(await verifyFreightTreeCreator(client, row, []), creatorAddress);
  await assert.rejects(verifyFreightTreeCreator(client, {...row, creatorAddress: owner}, []), /does not match its on-chain identity/);
});
