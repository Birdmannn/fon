import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { ccc } from "@ckb-ccc/core";
import { pilotWalletLock, PILOT_PASSKEY_CODE_HASH, PILOT_WALLET_SESSION_CODE_HASH, PILOT_WALLET_GENERAL_CODE_HASH, PILOT_TYPE_ID } from "@owl/pilot";
import { FREIGHT_PILOT_PROTOCOL, freightMessagePolicy } from "../lib/pilotProtocol.ts";
import type { PilotSignatureDependencies } from "../lib/pilotAuth.ts";
import type { PilotChallengeRecord } from "../lib/mongodb.ts";
const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { verifyAndConsumePilotSignature, verifyFreightPilotProof } = jiti("../lib/pilotAuth.ts") as typeof import("../lib/pilotAuth.ts");
const address = "ckt1-test-account";
const challenge = "abcdefghijklmnopqrstuvwx";
const message = `freight-interaction-like:${address}:${challenge}`;
const request = { address, nonce: message, signature: { identity: "account-hash", signature: "scoped-proof" }, expectedPurpose: "interaction-like" };

function fixture() {
  const record: PilotChallengeRecord = { _id: "server-challenge-id", address, permission: "interaction-like", origin: "https://freight.example", challenge, expiresAt: new Date(Date.now() + 60_000) };
  let consumed = false;
  const checked: Parameters<PilotSignatureDependencies["verifyProof"]>[0][] = [];
  const dependencies: PilotSignatureDependencies = {
    loadChallenge: async () => ({ ...record, consumedAt: consumed ? new Date() : undefined }),
    consumeChallenge: async () => { if (consumed) return false; consumed = true; return true; },
    verifyProof: async params => { checked.push(params); await Promise.resolve(); },
  };
  return { record, dependencies, checked };
}

test("Pilot API checks use the receiver's action and the server's issuing origin", async () => {
  const f = fixture();
  await verifyAndConsumePilotSignature(request, f.dependencies);
  assert.deepEqual(f.checked[0], {
    address, message, identity: request.signature.identity, serialized: request.signature.signature,
    permission: "interaction-like", origin: f.record.origin, challenge,
  });
  await assert.rejects(verifyAndConsumePilotSignature(request, f.dependencies), /already used/);
});

test("concurrent replay can consume a Pilot challenge only once", async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    verifyAndConsumePilotSignature(request, f.dependencies),
    verifyAndConsumePilotSignature(request, f.dependencies),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
});

test("wrong account, action, and expired challenges fail before cryptographic verification", async () => {
  const f = fixture();
  await assert.rejects(verifyAndConsumePilotSignature({ ...request, expectedPurpose: "interaction-comment" }, f.dependencies), /does not match/);
  f.record.address = "another-account";
  await assert.rejects(verifyAndConsumePilotSignature(request, f.dependencies), /missing, expired/);
  f.record.address = address; f.record.expiresAt = new Date(0);
  await assert.rejects(verifyAndConsumePilotSignature(request, f.dependencies), /missing, expired/);
  assert.equal(f.checked.length, 0);
});

test("an invalid live authority/signature never consumes the challenge", async () => {
  const f = fixture();
  f.dependencies.verifyProof = async () => { throw new Error("revoked authority"); };
  await assert.rejects(verifyAndConsumePilotSignature(request, f.dependencies), /revoked authority/);
  f.dependencies.verifyProof = async () => {};
  await verifyAndConsumePilotSignature(request, f.dependencies);
});

test("unknown protocols and oversized scoped proofs are rejected", async () => {
  const params = { address, message, identity: "hash", serialized: JSON.stringify({ protocol: "unknown" }), permission: "interaction-like" as const, origin: "https://freight.example", challenge };
  await assert.rejects(verifyFreightPilotProof(params), /Unknown Pilot proof/);
  await assert.rejects(verifyFreightPilotProof({ ...params, serialized: "x".repeat(32_769) }), /too large/);
});


test("profile authorization binds each live Pilot session to the same descriptor owner", async () => {
  const h = (byte: string) => `0x${byte.repeat(32)}` as ccc.Hex;
  const client = new ccc.ClientPublicTestnet();
  const ownerLock = ccc.Script.from({ codeHash: PILOT_PASSKEY_CODE_HASH, hashType: "data2", args: `0x${"22".repeat(97)}` });
  const owner = ccc.Address.fromScript(ownerLock, client).toString();
  let verified = 0;
  const verify: Parameters<typeof verifyFreightPilotProof>[2] = async (_client, descriptor, _state, proof, expected) => {
    verified++;
    assert.equal(ccc.Script.from(descriptor.ownerLock).hash(), ownerLock.hash());
    assert.equal(proof.accountHash, pilotWalletLock(descriptor).hash());
    assert.equal(expected.scope, "freight.wallet-seed");
    assert.equal(expected.nonce, challenge);
    return true;
  };
  for (const [seed, codeHash] of [["11", PILOT_WALLET_SESSION_CODE_HASH], ["99", PILOT_WALLET_GENERAL_CODE_HASH]] as const) {
    const account = {
      version: 2 as const,
      deployment: { network: "testnet" as const, genesisHash: h("aa"), codeHash, outPoint: { txHash: h("bb"), index: 0 } },
      ownerLock, stateType: { codeHash: PILOT_TYPE_ID, hashType: "type" as const, args: h(seed) },
      poolLock: { codeHash: h("44"), hashType: "type" as const, args: "0x" }, maxFee: "100000",
    };
    const sessionLock = pilotWalletLock(account);
    const session = ccc.Address.fromScript(sessionLock, client).toString();
    const state = { ...(codeHash === PILOT_WALLET_GENERAL_CODE_HASH ? {mode: "templates"} : {}), publicKey: `0x02${"33".repeat(32)}`, remaining: "10000000000", sequence: "0", appOrigin: "https://freight.example", policies: [freightMessagePolicy("wallet-seed")] };
    const message = `freight-wallet-seed:${owner}:${challenge}`;
    const proof = { version: 1, accountHash: sessionLock.hash(), appOrigin: state.appOrigin, publicKey: state.publicKey, scope: "freight.wallet-seed", message, nonce: challenge, expiresAt: Date.now() + 60_000, signature: h("55") };
    const params = { address: owner, message, identity: sessionLock.hash(), serialized: JSON.stringify({ protocol: FREIGHT_PILOT_PROTOCOL, account, state, proof }), permission: "wallet-seed" as const, origin: state.appOrigin, challenge };
    await verifyFreightPilotProof(params, client, verify);
    await assert.rejects(verifyFreightPilotProof({ ...params, address: session }, client, verify), /different owner/);
    await assert.rejects(verifyFreightPilotProof({ ...params, identity: ownerLock.hash() }, client, verify), /different owner/);
    await assert.rejects(verifyFreightPilotProof({ ...params, address: ccc.Address.fromScript(account.poolLock, client).toString() }, client, verify), /different owner/);
    await assert.rejects(verifyFreightPilotProof(params, client, async () => false), /invalid, revoked/);
  }
  assert.equal(verified, 2, "both sessions can authorize the same owner; rejected identities never reach signature verification");
});
