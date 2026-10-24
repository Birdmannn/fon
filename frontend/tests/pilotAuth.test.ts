import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
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
