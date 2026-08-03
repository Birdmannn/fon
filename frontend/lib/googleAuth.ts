import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

import { ClientPublicTestnet, Signature, Signer, SignerCkbPublicKey, SignerSignType } from "@ckb-ccc/core";

const GOOGLE_OAUTH_SCOPE = ["openid", "email", "profile"].join(" ");
const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_OAUTH_CODE_TTL_MS = 5 * 60 * 1000;
const GOOGLE_OAUTH_COOKIE_NAME = "freight_google_oauth";
const GOOGLE_LINK_CODE_COOKIE_NAME = "freight_google_link_code";
const GOOGLE_LINK_CODE_LENGTH = 10;

export type GoogleAccountPayload = {
  sub: string;
  email: string;
  emailVerified: boolean;
  picture?: string | null;
  linkedAt: string;
  lastRefreshedAt: string;
};

type GoogleOAuthStateRecord = {
  address: string;
  nonce: string;
  state: string;
  createdAt: number;
  redirectPath: string;
};

type GoogleLinkCodeRecord = {
  code: string;
  address: string;
  googleAccount: GoogleAccountPayload;
  createdAt: number;
};

type GoogleIdTokenPayload = {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  picture?: unknown;
};

const globalForGoogleAuth = globalThis as typeof globalThis & {
  __freightGoogleOAuthStates?: Map<string, GoogleOAuthStateRecord>;
  __freightGoogleLinkCodes?: Map<string, GoogleLinkCodeRecord>;
};

function getGoogleOAuthStates() {
  if (!globalForGoogleAuth.__freightGoogleOAuthStates) {
    globalForGoogleAuth.__freightGoogleOAuthStates = new Map();
  }

  return globalForGoogleAuth.__freightGoogleOAuthStates;
}

function getGoogleLinkCodes() {
  if (!globalForGoogleAuth.__freightGoogleLinkCodes) {
    globalForGoogleAuth.__freightGoogleLinkCodes = new Map();
  }

  return globalForGoogleAuth.__freightGoogleLinkCodes;
}

function nowMs() {
  return Date.now();
}

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function randomToken(size = 24) {
  return randomBytes(size).toString("base64url");
}

export function buildWalletActionNonce(address: string, purpose = "wallet-action") {
  return `freight-${purpose}:${normalizeAddress(address)}:${randomToken(18)}`;
}

function cleanExpiredGoogleOAuthStates() {
  const states = getGoogleOAuthStates();
  const cutoff = nowMs() - GOOGLE_OAUTH_STATE_TTL_MS;
  for (const [key, value] of states.entries()) {
    if (value.createdAt < cutoff) {
      states.delete(key);
    }
  }
}

function cleanExpiredGoogleLinkCodes() {
  const codes = getGoogleLinkCodes();
  const cutoff = nowMs() - GOOGLE_OAUTH_CODE_TTL_MS;
  for (const [key, value] of codes.entries()) {
    if (value.createdAt < cutoff) {
      codes.delete(key);
    }
  }
}

export function buildGoogleNonce(address: string) {
  return `freight-google-link:${normalizeAddress(address)}:${randomToken(18)}`;
}

export function createGoogleOAuthState(params: {
  address: string;
  nonce: string;
  redirectPath?: string | null;
}) {
  cleanExpiredGoogleOAuthStates();
  const state = randomToken(24);
  const record: GoogleOAuthStateRecord = {
    address: normalizeAddress(params.address),
    nonce: params.nonce,
    state,
    createdAt: nowMs(),
    redirectPath: params.redirectPath?.trim() || "/",
  };

  getGoogleOAuthStates().set(state, record);
  return record;
}

export function consumeGoogleOAuthState(state: string) {
  cleanExpiredGoogleOAuthStates();
  const states = getGoogleOAuthStates();
  const record = states.get(state) ?? null;
  if (record) {
    states.delete(state);
  }
  return record;
}

export function buildGoogleAuthorizeUrl(state: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) {
    throw new Error("Missing Google OAuth environment variables");
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_OAUTH_SCOPE);
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function verifyWalletSignature(params: {
  address: string;
  nonce: string;
  signature: {
    signature: string;
    identity: string;
    signType: SignerSignType;
  };
}) {
  const signer = new SignerCkbPublicKey(new ClientPublicTestnet(), params.signature.identity);
  const addressObj = await signer.getRecommendedAddressObj();
  const derivedAddress = normalizeAddress(addressObj.toString());
  const expectedAddress = normalizeAddress(params.address);
  if (derivedAddress !== expectedAddress) {
    throw new Error("Wallet signature identity does not match the provided address");
  }

  const verified = await Signer.verifyMessage(params.nonce, new Signature(
    params.signature.signature,
    params.signature.identity,
    params.signature.signType,
  ));

  if (!verified) {
    throw new Error("Wallet signature verification failed");
  }
}

export async function exchangeGoogleCodeForAccount(code: string): Promise<GoogleAccountPayload> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing Google OAuth environment variables");
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokenPayload = await tokenResponse.json().catch(() => null) as { id_token?: string; error?: string; error_description?: string } | null;
  if (!tokenResponse.ok || !tokenPayload?.id_token) {
    throw new Error(tokenPayload?.error_description ?? tokenPayload?.error ?? "Failed to complete Google OAuth");
  }

  const segments = tokenPayload.id_token.split(".");
  if (segments.length < 2) {
    throw new Error("Google returned an invalid ID token");
  }

  const decoded = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8")) as GoogleIdTokenPayload;
  const sub = typeof decoded.sub === "string" ? decoded.sub : "";
  const email = typeof decoded.email === "string" ? decoded.email.trim().toLowerCase() : "";
  const emailVerified = decoded.email_verified === true || decoded.email_verified === "true";
  const picture = typeof decoded.picture === "string" ? decoded.picture : null;

  if (!sub || !email) {
    throw new Error("Google account payload is missing required identity fields");
  }

  if (!emailVerified) {
    throw new Error("Google account email must be verified");
  }

  const now = new Date().toISOString();
  return {
    sub,
    email,
    emailVerified,
    picture,
    linkedAt: now,
    lastRefreshedAt: now,
  };
}

export function createGoogleLinkCode(address: string, googleAccount: GoogleAccountPayload) {
  cleanExpiredGoogleLinkCodes();
  const code = randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, GOOGLE_LINK_CODE_LENGTH).toUpperCase();
  const record: GoogleLinkCodeRecord = {
    code,
    address: normalizeAddress(address),
    googleAccount,
    createdAt: nowMs(),
  };
  getGoogleLinkCodes().set(code, record);
  return record;
}

export function consumeGoogleLinkCode(code: string) {
  cleanExpiredGoogleLinkCodes();
  const normalized = code.trim().toUpperCase();
  const codes = getGoogleLinkCodes();
  const record = codes.get(normalized) ?? null;
  if (record) {
    codes.delete(normalized);
  }
  return record;
}

export function buildGoogleOAuthCookieValue(state: string) {
  const secret = process.env.GOOGLE_LINK_STATE_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing GOOGLE_LINK_STATE_SECRET environment variable");
  }

  const signature = sha256Hex(`${state}:${secret}`);
  return `${state}.${signature}`;
}

export function parseGoogleOAuthCookieValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const secret = process.env.GOOGLE_LINK_STATE_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing GOOGLE_LINK_STATE_SECRET environment variable");
  }

  const separator = value.lastIndexOf(".");
  if (separator === -1) {
    return null;
  }

  const state = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expectedSignature = sha256Hex(`${state}:${secret}`);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  return state;
}

export function buildGoogleLinkCookieValue(params: { address: string; code: string }) {
  const secret = process.env.GOOGLE_LINK_STATE_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing GOOGLE_LINK_STATE_SECRET environment variable");
  }

  const address = normalizeAddress(params.address);
  const code = params.code.trim().toUpperCase();
  const signature = sha256Hex(`${address}:${code}:${secret}`);
  return `${address}.${code}.${signature}`;
}

export function parseGoogleLinkCookieValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const secret = process.env.GOOGLE_LINK_STATE_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing GOOGLE_LINK_STATE_SECRET environment variable");
  }

  const parts = value.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [address, code, signature] = parts;
  const expectedSignature = sha256Hex(`${normalizeAddress(address)}:${code.trim().toUpperCase()}:${secret}`);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  return {
    address: normalizeAddress(address),
    code: code.trim().toUpperCase(),
  };
}

export function getGoogleOAuthCookieName() {
  return GOOGLE_OAUTH_COOKIE_NAME;
}

export function getGoogleLinkCodeCookieName() {
  return GOOGLE_LINK_CODE_COOKIE_NAME;
}
