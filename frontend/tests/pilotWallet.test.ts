import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { ccc } from "@ckb-ccc/core";
import { validatePilotPolicies, validatePilotPolicyCatalog } from "@owl/pilot";
import type { PilotWalletProvider, PilotWalletConnection, PilotWalletState } from "@owl/pilot";
import { FreightPilotSigner, completeFreightFee } from "../lib/pilotWallet.ts";
import { FREIGHT_PERMISSIONS } from "../lib/owlPermissions.ts";
import { freightActionPolicy, freightPilotChallenge, mergePilotPolicies, mergePilotPolicyCatalog } from "../lib/pilotProtocol.ts";

const hex = (byte: string) => `0x${byte.repeat(32)}` as ccc.Hex;
const lock = ccc.Script.from({ codeHash: hex("11"), hashType: "type", args: `0x${"22".repeat(20)}` });
const client = new ccc.ClientPublicTestnet();
const address = ccc.Address.fromScript(lock, client).toString();
const state: PilotWalletState = { publicKey: `0x02${"33".repeat(32)}`, remaining: "10000000000", sequence: "0", appOrigin: "https://freight.example", policies: [freightActionPolicy("creator-tip")] };

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
  const action = freightActionPolicy("creator-tip");
  assert.equal(mergePilotPolicies([action], [{ ...action, maxCapacity: "2" }]).length, 1);
  assert.equal(mergePilotPolicies([action], [{ ...action, lockHash: hex("aa") }]).length, 2);
  assert.throws(() => mergePilotPolicies(FREIGHT_PERMISSIONS.slice(0, 17).map(([id]) => freightActionPolicy(id))), /16 policies/);
});

test("the full Freight catalog is offered while approved grants remain capped at sixteen", () => {
  const catalog = mergePilotPolicyCatalog(FREIGHT_PERMISSIONS.map(([id]) => freightActionPolicy(id)));
  assert.equal(catalog.length, 28);
  assert.doesNotThrow(() => validatePilotPolicyCatalog(catalog));
  assert.doesNotThrow(() => validatePilotPolicies(catalog.slice(0, 16)));
  assert.throws(() => validatePilotPolicies(catalog.slice(0, 17)), /16/);
  const distinct = Array.from({ length: 51 }, (_, index) => ({ ...catalog[0], lockHash: `0x${index.toString(16).padStart(64, "0")}` as ccc.Hex }));
  assert.doesNotThrow(() => validatePilotPolicyCatalog(mergePilotPolicyCatalog(distinct.slice(0, 50))));
  assert.throws(() => mergePilotPolicyCatalog(distinct), /50 policies/);
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
    account: { address, account: { version: 2 }, appOrigin: state.appOrigin, expiresAt: Date.now() + 60_000 } as PilotWalletConnection,
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
  const message = `freight-creator-tip:${address}:${nonce}`;
  const signature = await f.signer.signFreightScope("creator-tip", message);
  assert.equal(signature.signType, ccc.SignerSignType.Unknown);
  assert.equal(signature.identity, lock.hash());
  assert.deepEqual(f.calls.find(call => call.method === "signMessage")!.params, { scope: "freight.creator-tip", message, nonce });
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
  const message = `freight-wallet-seed:${address}:abcdefghijklmnopqrstuvwx`;
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
