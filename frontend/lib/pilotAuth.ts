import { createHash } from "node:crypto";
import { ccc } from "@ckb-ccc/core";
import { parsePilotWalletDescriptor, pilotWalletLock, validatePilotPolicies, verifyPilotScopedMessage } from "@owl/pilot";
import { getPublicCkbClient } from "./ckbClient";
import { getPilotChallengesCollection, type PilotChallengeRecord } from "./mongodb";
import { FREIGHT_PILOT_PROTOCOL, freightPilotChallenge, freightPilotScope, freightPermissionFromPurpose, isOwnerProfilePermission, type FreightPilotProof } from "./pilotProtocol";
import type { FreightPermission } from "./owlPermissions";

// Scoped proofs include the selected templates; the largest 16 FON policies
// currently occupy about 86 KB before the descriptor and signature envelope.
export const MAX_FREIGHT_PILOT_PROOF_BYTES = 128 * 1024;

const challengeId = (message: string) => createHash("sha256").update(message).digest("hex");

export async function registerPilotChallenge(address: string, purpose: string, message: string, origin: string) {
  const permission = freightPermissionFromPurpose(purpose);
  // Photo uploads append the file digest only after this challenge is issued.
  const challenge = message.split(":").at(-1)!;
  const collection = await getPilotChallengesCollection();
  await collection.insertOne({
    _id: challengeId(message), address: address.trim().toLowerCase(), permission,
    origin: new URL(origin).origin, challenge, expiresAt: new Date(Date.now() + 10 * 60_000),
  });
}

export async function verifyFreightPilotProof(params: {
  address: string; message: string; identity: string; serialized: string;
  permission: FreightPermission; origin: string; challenge: string;
}, client: ccc.Client = getPublicCkbClient(), verifyScoped: typeof verifyPilotScopedMessage = verifyPilotScopedMessage) {
  if (Buffer.byteLength(params.serialized, "utf8") > MAX_FREIGHT_PILOT_PROOF_BYTES) throw new Error("Pilot proof is too large.");
  const envelope = JSON.parse(params.serialized) as FreightPilotProof;
  if (envelope.protocol !== FREIGHT_PILOT_PROTOCOL) throw new Error("Unknown Pilot proof protocol.");
  const account = parsePilotWalletDescriptor(envelope.account);
  validatePilotPolicies(envelope.state.policies);
  const lock = pilotWalletLock(account);
  const expected = await ccc.Address.fromString(params.address, client);
  const ownerMatches = ccc.Script.from(account.ownerLock).eq(expected.script);
  const sessionMatches = !isOwnerProfilePermission(params.permission) && lock.eq(expected.script);
  if ((!ownerMatches && !sessionMatches) || params.identity !== lock.hash()) throw new Error("Pilot proof belongs to a different owner or account.");
  if (envelope.proof.message !== params.message || !(await verifyScoped(client, account, envelope.state, envelope.proof, {
    appOrigin: params.origin, scope: freightPilotScope(params.permission), nonce: params.challenge,
  }))) throw new Error("Pilot scoped signature is invalid, revoked, expired, or outside the selected action.");
}

export interface PilotSignatureDependencies {
  loadChallenge: (id: string) => Promise<PilotChallengeRecord | null>;
  consumeChallenge: (id: string, now: Date) => Promise<boolean>;
  verifyProof: typeof verifyFreightPilotProof;
}
const signatureDependencies: PilotSignatureDependencies = {
  loadChallenge: async id => (await getPilotChallengesCollection()).findOne({ _id: id }),
  consumeChallenge: async (id, now) => {
    const result = await (await getPilotChallengesCollection()).updateOne(
      { _id: id, consumedAt: { $exists: false }, expiresAt: { $gt: now } }, { $set: { consumedAt: now } },
    );
    return result.modifiedCount === 1;
  },
  verifyProof: verifyFreightPilotProof,
};

export async function verifyAndConsumePilotSignature(params: {
  address: string; nonce: string; signature: { identity: string; signature: string }; expectedPurpose?: string;
}, dependencies: PilotSignatureDependencies = signatureDependencies) {
  if (!params.expectedPurpose) throw new Error("This endpoint has no Pilot signing scope.");
  const permission = freightPermissionFromPurpose(params.expectedPurpose);
  const challenge = freightPilotChallenge(params.nonce, params.address, permission);
  const record = await dependencies.loadChallenge(challengeId(challenge.issuedMessage));
  if (!record || record.address !== params.address.trim().toLowerCase() || record.permission !== permission ||
      record.consumedAt || record.expiresAt.getTime() <= Date.now() || record.challenge !== challenge.nonce) {
    throw new Error("Pilot signing challenge is missing, expired, or already used.");
  }
  await dependencies.verifyProof({
    address: params.address, message: params.nonce, identity: params.signature.identity,
    serialized: params.signature.signature, permission, origin: record.origin, challenge: record.challenge,
  });
  // A single conditional update provides replay protection across server instances.
  // A later business-rule failure needs a fresh challenge; it never reuses a proof.
  if (!(await dependencies.consumeChallenge(record._id, new Date()))) throw new Error("Pilot signing challenge was already consumed.");
}
