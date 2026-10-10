import { type CredentialKeyType, type SigningAlg, verifyCredential, verifySignature } from "@joyid/ckb";
import { collection, usesDatabase } from "@/lib/database";

export const JOYID_SESSION_COOKIE = "fon_checkbox_demo_joyid";

type JoyIdSession = {
  address: string;
  createdAt: string;
};

type JoyIdChallenge = {
  challenge: string;
  expiresAt: number;
};

declare global {
  var __fonCheckboxDemoJoyIdSessions: Map<string, JoyIdSession> | undefined;
  var __fonCheckboxDemoJoyIdChallenges: Map<string, JoyIdChallenge> | undefined;
}

const sessions = globalThis.__fonCheckboxDemoJoyIdSessions ?? new Map<string, JoyIdSession>();
globalThis.__fonCheckboxDemoJoyIdSessions = sessions;
const challenges = globalThis.__fonCheckboxDemoJoyIdChallenges ?? new Map<string, JoyIdChallenge>();
globalThis.__fonCheckboxDemoJoyIdChallenges = challenges;

function joyIdServerUrl() {
  return process.env.NEXT_PUBLIC_CKB_NETWORK?.trim().toLowerCase() === "mainnet"
    ? "https://api.joy.id/api/v1"
    : "https://api.testnet.joyid.dev/api/v1";
}

export async function createJoyIdSession(input: {
  challengeId: string;
  challenge: string;
  address: string;
  pubkey: string;
  keyType: CredentialKeyType;
  alg: SigningAlg;
  message: string;
  signature: string;
}) {
  const address = input.address.trim();
  const pubkey = input.pubkey.trim();
  if (!address || !pubkey) throw new Error("JoyID did not return a wallet credential");

  const issuedChallenge = usesDatabase()
    ? await (await collection<JoyIdChallenge & { _id: string }>("loginChallenges")).findOneAndDelete({ _id: input.challengeId })
    : challenges.get(input.challengeId);
  challenges.delete(input.challengeId);
  if (!issuedChallenge || issuedChallenge.expiresAt < Date.now() || issuedChallenge.challenge !== input.challenge) {
    throw new Error("JoyID login challenge is invalid or expired");
  }

  const valid = await verifyCredential({
    address,
    pubkey,
    keyType: input.keyType,
    alg: input.alg,
  }, joyIdServerUrl());
  if (!valid) throw new Error("JoyID credential verification failed");
  const signatureValid = await verifySignature({
    challenge: input.challenge,
    message: input.message,
    signature: input.signature,
    pubkey,
    keyType: input.keyType,
    alg: input.alg,
  });
  if (!signatureValid) throw new Error("JoyID login signature verification failed");

  const sessionId = crypto.randomUUID();
  const session = { address: address.toLowerCase(), createdAt: new Date().toISOString() };
  if (usesDatabase()) {
    const records = await collection<JoyIdSession & { _id: string; expiresAt: Date }>("loginSessions");
    await records.insertOne({ _id: sessionId, ...session, expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000) });
  } else {
    sessions.set(sessionId, session);
  }
  return { sessionId, address };
}

export async function createJoyIdChallenge() {
  const challengeId = crypto.randomUUID();
  const challenge = `FON Checkbox Demo login:${crypto.randomUUID()}`;
  const issued = { challenge, expiresAt: Date.now() + 5 * 60 * 1000 };
  if (usesDatabase()) {
    await (await collection<JoyIdChallenge & { _id: string }>("loginChallenges")).insertOne({ _id: challengeId, ...issued });
  } else {
    challenges.set(challengeId, issued);
  }
  return { challengeId, challenge };
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
}

export async function getJoyIdSession(request: Request) {
  const sessionId = decodeURIComponent(cookieValue(request, JOYID_SESSION_COOKIE));
  if (!sessionId) return null;
  if (usesDatabase()) {
    const record = await (await collection<JoyIdSession & { _id: string; expiresAt: Date }>("loginSessions"))
      .findOne({ _id: sessionId, expiresAt: { $gt: new Date() } });
    return record ? { address: record.address, createdAt: record.createdAt } : null;
  }
  return sessions.get(sessionId) ?? null;
}

export async function deleteJoyIdSession(request: Request) {
  const sessionId = decodeURIComponent(cookieValue(request, JOYID_SESSION_COOKIE));
  if (!sessionId) return;
  if (usesDatabase()) {
    await (await collection<JoyIdSession & { _id: string; expiresAt: Date }>("loginSessions")).deleteOne({ _id: sessionId });
  } else {
    sessions.delete(sessionId);
  }
}
