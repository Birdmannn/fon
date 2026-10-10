import { type CredentialKeyType, type SigningAlg, verifyCredential, verifySignature } from "@joyid/ckb";

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

  const issuedChallenge = challenges.get(input.challengeId);
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
  sessions.set(sessionId, { address: address.toLowerCase(), createdAt: new Date().toISOString() });
  return { sessionId, address };
}

export function createJoyIdChallenge() {
  const challengeId = crypto.randomUUID();
  const challenge = `FON Checkbox Demo login:${crypto.randomUUID()}`;
  challenges.set(challengeId, { challenge, expiresAt: Date.now() + 5 * 60 * 1000 });
  return { challengeId, challenge };
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? "";
}

export function getJoyIdSession(request: Request) {
  const sessionId = decodeURIComponent(cookieValue(request, JOYID_SESSION_COOKIE));
  return sessionId ? sessions.get(sessionId) ?? null : null;
}

export function deleteJoyIdSession(request: Request) {
  const sessionId = decodeURIComponent(cookieValue(request, JOYID_SESSION_COOKIE));
  if (sessionId) sessions.delete(sessionId);
}
