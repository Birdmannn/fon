import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ccc } from "@ckb-ccc/core";
import { buildPilotWalletTransaction, encodePilotWalletState, validatePilotPolicies, validatePilotPolicyCatalog, pilotWalletLock, PILOT_PASSKEY_CODE_HASH, PILOT_WALLET_SESSION_CODE_HASH, PILOT_TYPE_ID } from "@owl/pilot";
import type { PilotWalletProvider, PilotWalletConnection, PilotWalletState, PilotWalletDescriptor } from "@owl/pilot";
import { getFreightProfileAddress, getFreightWalletDisplayBalance } from "../lib/profileIdentity.ts";
import { FreightPilotSigner, completeFreightFee } from "../lib/pilotWallet.ts";
import { FREIGHT_MESSAGE_PERMISSIONS } from "../lib/owlPermissions.ts";
import { freightMessagePolicy, freightPilotCatalog, freightPilotChallenge, mergePilotPolicies, mergePilotPolicyCatalog } from "../lib/pilotProtocol.ts";

const hex = (byte: string) => `0x${byte.repeat(32)}` as ccc.Hex;
const client = new ccc.ClientPublicTestnet();
const ownerLock = ccc.Script.from({ codeHash: PILOT_PASSKEY_CODE_HASH, hashType: "data2", args: `0x${"22".repeat(97)}` });
const ownerAddress = ccc.Address.fromScript(ownerLock, client).toString();
const account: PilotWalletDescriptor = {
  version: 2,
  deployment: { network: "testnet", genesisHash: hex("aa"), codeHash: PILOT_WALLET_SESSION_CODE_HASH, outPoint: { txHash: hex("bb"), index: 0 } },
  ownerLock, stateType: { codeHash: PILOT_TYPE_ID, hashType: "type", args: hex("11") },
  poolLock: { codeHash: hex("44"), hashType: "type", args: "0x" }, maxFee: "100000",
};
const lock = pilotWalletLock(account);
const address = ccc.Address.fromScript(lock, client).toString();
const state: PilotWalletState = { publicKey: `0x02${"33".repeat(32)}`, remaining: "10000000000", sequence: "0", appOrigin: "https://freight.example", policies: [freightMessagePolicy("deposit")] };

test("Freight challenges bind account, action, Google purpose, and photo digest", () => {
  const challenge = "abcdefghijklmnopqrstuvwx";
  assert.equal(freightPilotChallenge(`freight-interaction-like:${address}:${challenge}`, address, "interaction-like").nonce, challenge);
  assert.throws(() => freightPilotChallenge(`freight-interaction-like:${address}:${challenge}`, address, "interaction-comment"), /does not match/);
  assert.throws(() => freightPilotChallenge(`freight-interaction-like:${address}:${challenge}:suffix`, address, "interaction-like"), /Invalid/);
  const photo = `freight-profile-photo:${address}:${challenge}`;
  assert.equal(freightPilotChallenge(`${photo}:${"ab".repeat(32)}`, address, "profile-photo").issuedMessage, photo);
  assert.throws(() => freightPilotChallenge(`${photo}:not-a-digest`, address, "profile-photo"), /Invalid/);
  assert.equal(freightPilotChallenge(`freight-google-link:forms_response_access:${address}:${challenge}`, address, "google-forms-link").nonce, challenge);
  assert.throws(() => freightPilotChallenge(`freight-google-link:identity_link:${address}:${challenge}`, address, "google-forms-link"), /does not match/);
});

test("policy merging preserves recipient/type/data boundaries and the SDK's limit", () => {
  const action = freightMessagePolicy("deposit");
  assert.equal(mergePilotPolicies([action], [{ ...action, maxCapacity: "2" }]).length, 1);
  assert.equal(mergePilotPolicies([action], [{ ...action, lockHash: hex("aa") }]).length, 2);
  assert.throws(() => mergePilotPolicies(Array.from({ length: 17 }, (_, index) => ({ ...action, lockHash: `0x${index.toString(16).padStart(64, "0")}` as ccc.Hex }))), /16 policies/);
});

test("the catalog separates actual message scopes and cell rules while grants remain capped at sixteen", () => {
  const messages = freightPilotCatalog();
  assert.equal(messages.length, FREIGHT_MESSAGE_PERMISSIONS.length);
  assert.equal(messages.some(policy => policy.name === "Publish freight" || policy.name === "Buy raffle tickets"), false);
  assert.equal(messages.find(policy => policy.name === "Sign support receipt")?.direction, "message");
  const catalog = freightPilotCatalog([
    { ...messages[0], name: "Publish freight: output 1", direction: "output", lockHash: hex("aa") },
    { ...messages[0], name: "Buy raffle tickets: output 1", direction: "output", lockHash: hex("bb") },
  ]);
  assert.equal(catalog.length, 17);
  assert.doesNotThrow(() => validatePilotPolicyCatalog(catalog));
  assert.doesNotThrow(() => validatePilotPolicies(catalog.slice(0, 16)));
  assert.throws(() => validatePilotPolicies(catalog.slice(0, 17)), /16/);
  const distinct = Array.from({ length: 51 }, (_, index) => ({ ...catalog[0], lockHash: `0x${index.toString(16).padStart(64, "0")}` as ccc.Hex }));
  assert.doesNotThrow(() => validatePilotPolicyCatalog(mergePilotPolicyCatalog(distinct.slice(0, 50))));
  assert.throws(() => mergePilotPolicyCatalog(distinct), /50 policies/);
});

test("selected message scopes do not authorize transaction effects or wildcard type arguments", async () => {
  const selected = { ...state, remaining: ccc.fixedPointFrom(1000).toString(), policies: [freightMessagePolicy("deposit"), freightMessagePolicy("creator-withdraw")] };
  const anchor = ccc.Cell.from({ outPoint: { txHash: hex("55"), index: 0 },
    cellOutput: { lock, type: account.stateType, capacity: ccc.fixedPointFrom(10000) }, outputData: encodePilotWalletState(selected) });
  const mock = { findCellsByLock: async function* () { yield anchor; }, getCellLive: async () => anchor } as unknown as ccc.Client;
  const effects = ccc.Transaction.from({ outputs: [{ lock: ownerLock, type: account.stateType, capacity: ccc.fixedPointFrom(500) }], outputsData: ["0x"] });
  // Use an application type, distinct from the authority that Pilot builds itself.
  effects.outputs[0].type = ccc.Script.from({ codeHash: hex("66"), hashType: "type", args: "0x00" });
  await assert.rejects(buildPilotWalletTransaction(mock, account, selected, effects, false, anchor), /Output is outside session policies/);
  assert.equal((await buildPilotWalletTransaction(mock, account, selected, effects, true, anchor)).outputs.length, 2);
  const granted = { ...selected, policies: [{ name: "Exact output", direction: "output" as const,
    lockHash: ownerLock.hash(), typeHash: effects.outputs[0].type.hash(), dataHash: hex("00"), maxCapacity: ccc.fixedPointFrom(500).toString() }] };
  anchor.outputData = encodePilotWalletState(granted);
  await buildPilotWalletTransaction(mock, account, granted, effects, false, anchor);
  effects.outputs[0].type.args = "0x0001";
  await assert.rejects(buildPilotWalletTransaction(mock, account, granted, effects, false, anchor), /Output is outside session policies/);
});

function fixture(t: TestContext) {
  const storage = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "localStorage", previous); else Reflect.deleteProperty(globalThis, "localStorage"); });
  const calls: { method: string; params?: unknown }[] = [];
  let loseResponse = false;
  let ownerApproval = false;
  const provider = {
    connected: true,
    account: { address, ownerAddress, account, appOrigin: state.appOrigin, expiresAt: Date.now() + 60_000 } as PilotWalletConnection,
    request: async (method: string, params?: unknown) => {
      calls.push({ method, params });
      if (method === "logs") return { state, stopped: false, receipts: [] };
      if (method === "prepare") return (params as { bytes: ccc.Hex }).bytes;
      if (method === "signMessage") return {
        ...(ownerApproval ? { version: 2, passkey: { credentialId: "owner-passkey" }, assertion: { signature: "0xab" } } : { version: 1, signature: `0x${"aa".repeat(64)}` }), accountHash: lock.hash(), appOrigin: state.appOrigin, publicKey: state.publicKey,
        ...params as object, expiresAt: Date.now() + 60_000,
      };
      if (method === "send") {
        assert.equal(storage.size, 1, "save before a wallet request can sign/broadcast");
        if (loseResponse) { loseResponse = false; throw new Error("response lost"); }
        return hex("77");
      }
      throw new Error("Unexpected wallet request");
    },
  } as unknown as PilotWalletProvider;
  return { signer: new FreightPilotSigner(client, provider), calls, storage, loseResponse: () => { loseResponse = true; }, ownerApproval: () => { ownerApproval = true; } };
}

test("scoped signing sends the server challenge and preserves the full API message", async t => {
  const f = fixture(t);
  const previous = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: state.appOrigin } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "location", previous); else Reflect.deleteProperty(globalThis, "location"); });
  const nonce = "abcdefghijklmnopqrstuvwx";
  const message = `freight-deposit:${address}:${nonce}`;
  const signature = await f.signer.signFreightScope("deposit", message);
  assert.equal(signature.signType, ccc.SignerSignType.Unknown);
  assert.equal(signature.identity, lock.hash());
  assert.deepEqual(f.calls.find(call => call.method === "signMessage")!.params, { scope: "freight.deposit", message, nonce });
  const envelope = JSON.parse(signature.signature);
  assert.equal(envelope.protocol, "freight-pilot-scoped-v1");
  assert.equal(envelope.proof.message, message);
  assert.equal(envelope.state.publicKey, state.publicKey);
  assert.equal(f.calls.some(call => ["send", "prepare"].includes(call.method)), false);
});

test("lost wallet responses retry exact prepared bytes and the same stable ID", async t => {
  const f = fixture(t);
  const tx = ccc.Transaction.from({ outputs: [{ lock, capacity: ccc.fixedPointFrom(61) }], outputsData: ["0x"] });
  f.loseResponse();
  await assert.rejects(f.signer.sendFreightEffects(tx), /response lost/);
  const different = tx.clone(); different.outputs[0].capacity += 1n;
  await assert.rejects(f.signer.sendFreightEffects(different), /unresolved/);
  assert.equal(await f.signer.sendFreightEffects(tx), hex("77"));
  assert.deepEqual(f.calls.filter(call => call.method === "send")[0].params, f.calls.filter(call => call.method === "send")[1].params);
  assert.equal(f.calls.filter(call => call.method === "prepare").length, 1);
  const sendCount = f.calls.filter(call => call.method === "send").length;
  assert.equal(await f.signer.sendFreightEffects(tx), hex("77"));
  assert.equal(f.calls.filter(call => call.method === "send").length, sendCount, "known success must not be sent again");
});

test("new recipients reach the existing wallet for one-time approval without replacing the grant", async t => {
  const f = fixture(t);
  const recipient = ccc.Script.from({ ...lock, args: `0x${"44".repeat(20)}` });
  const tx = ccc.Transaction.from({ outputs: [{ lock: recipient, capacity: ccc.fixedPointFrom(61) }], outputsData: ["0x"] });
  assert.equal(await f.signer.sendFreightEffects(tx), hex("77"));
  assert.deepEqual(f.calls.map(call => call.method), ["logs", "prepare", "send"]);
  assert.equal(f.calls.some(call => call.method === "connect"), false);
});

test("unselected scoped actions preserve one-time owner proofs for the receiving API", async t => {
  const f = fixture(t);
  f.ownerApproval();
  const previous = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: state.appOrigin } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "location", previous); else Reflect.deleteProperty(globalThis, "location"); });
  const message = `freight-wallet-seed:${ownerAddress}:abcdefghijklmnopqrstuvwx`;
  const signature = await f.signer.signFreightScope("wallet-seed", message);
  const envelope = JSON.parse(signature.signature);
  assert.equal(envelope.proof.version, 2);
  assert.equal(envelope.proof.passkey.credentialId, "owner-passkey");
  assert.equal(envelope.proof.assertion.signature, "0xab");
  assert.equal(envelope.proof.scope, "freight.wallet-seed");
  assert.deepEqual(envelope.state.policies, state.policies, "one-time approval must not expand the grant");
  assert.equal(f.calls.some(call => call.method === "connect"), false);
});

test("Pilot builders skip generic CCC fee/input completion", async t => {
  const f = fixture(t);
  const tx = ccc.Transaction.default();
  let calls = 0;
  tx.completeFeeBy = async () => { calls++; return [0, false]; };
  await completeFreightFee(tx, f.signer, 1000n);
  assert.equal(calls, 0);
  await completeFreightFee(tx, {} as ccc.Signer, 1000n);
  assert.equal(calls, 1);
});


test("different Pilot spending accounts share their owner's profile identity", async t => {
  const f = fixture(t);
  assert.equal(await getFreightProfileAddress(f.signer), ownerAddress);
  assert.equal(await f.signer.getRecommendedAddress(), address, "transaction address remains the session account");
  const otherAccount = { ...account, stateType: { ...ccc.Script.from(account.stateType), args: hex("99") } };
  const otherAddress = ccc.Address.fromScript(pilotWalletLock(otherAccount), client).toString();
  const other = new FreightPilotSigner(client, { account: { ...f.signer.provider.account!, account: otherAccount, address: otherAddress } } as unknown as PilotWalletProvider);
  assert.notEqual(await other.getRecommendedAddress(), address);
  assert.equal(await getFreightProfileAddress(other), ownerAddress);
  const external = new ccc.SignerCkbPrivateKey(client, hex("12"));
  assert.equal(await getFreightProfileAddress(external), await external.getRecommendedAddress());
});

test("Pilot profile proofs reject session-address seed challenges and inconsistent owner claims", async t => {
  const f = fixture(t);
  await assert.rejects(f.signer.signFreightScope("wallet-seed", `freight-wallet-seed:${address}:abcdefghijklmnopqrstuvwx`), /does not match/);
  assert.equal(f.calls.length, 0);
  const inconsistent = new FreightPilotSigner(client, { account: { ...f.signer.provider.account!, ownerAddress: address } } as unknown as PilotWalletProvider);
  await assert.rejects(getFreightProfileAddress(inconsistent), /inconsistent/);
});

test("Pilot wallet displays query total owner capacity, never session balance", async t => {
  const f = fixture(t);
  const capacity = 2500n * 100_000_000n;
  t.mock.method(client, "getCellsCapacity", async (query: ccc.ClientIndexerSearchKeyLike) => {
    assert.equal(ccc.Script.from(query.script).hash(), ownerLock.hash());
    assert.equal(query.scriptType, "lock");
    assert.equal(query.scriptSearchMode, "exact");
    return capacity;
  });
  t.mock.method(f.signer, "getBalance", async () => { throw new Error("Session balance must not be displayed"); });
  assert.equal(await getFreightWalletDisplayBalance(client, f.signer), capacity);
  const external = new ccc.SignerCkbPrivateKey(client, hex("12"));
  t.mock.method(external, "getBalance", async () => 123n);
  assert.equal(await getFreightWalletDisplayBalance(client, external), 123n);
});
