import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

import { Signature, Signer, SignerCkbPublicKey, SignerSignType } from "@ckb-ccc/core";
import { type CredentialKeyType, verifyCredential } from "@joyid/ckb";
import { type SigningAlg } from "@joyid/common";

import { getPublicCkbClient } from "@/lib/ckbClient";

const joyidServerUrl = process.env.NEXT_PUBLIC_CKB_NETWORK?.trim().toLowerCase() === "mainnet"
  ? "https://api.joy.id/api/v1"
  : "https://api.testnet.joyid.dev/api/v1";

const GOOGLE_IDENTITY_SCOPES = ["openid", "email", "profile"] as const;
export const GOOGLE_FORMS_RESPONSES_SCOPE = "https://www.googleapis.com/auth/forms.responses.readonly";
const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_OAUTH_CODE_TTL_MS = 5 * 60 * 1000;
const GOOGLE_OAUTH_COOKIE_NAME = "freight_google_oauth";
const GOOGLE_LINK_CODE_COOKIE_NAME = "freight_google_link_code";
const GOOGLE_LINK_CODE_LENGTH = 10;
const GOOGLE_ACCESS_TOKEN_REFRESH_SKEW_MS = 60 * 1000;

export type GoogleLinkPurpose = "identity_link" | "forms_response_access";
export type GoogleOAuthGrantKind = "forms_response_access";

export type GoogleAccountPayload = {
  sub: string;
  email: string;
  emailVerified: boolean;
  picture?: string | null;
  linkedAt: string;
  lastRefreshedAt: string;
};

export type GoogleOAuthGrantPayload = {
  grantKind: GoogleOAuthGrantKind;
  googleAccount: GoogleAccountPayload;
  scopes: string[];
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  refreshToken: string | null;
  tokenType: string | null;
  linkedAt: string;
  lastRefreshedAt: string;
};

export type GoogleOAuthGrantSummary = {
  grantKind: GoogleOAuthGrantKind;
  email: string;
  linkedAt: string;
  lastRefreshedAt: string;
  scopes: string[];
  hasRefreshToken: boolean;
};

type GoogleOAuthStateRecord = {
  address: string;
  nonce: string;
  state: string;
  createdAt: number;
  redirectPath: string;
  purpose: GoogleLinkPurpose;
  requestedScopes: string[];
  needsOfflineAccess: boolean;
  promptConsent: boolean;
};

type GoogleLinkCodeRecord = {
  code: string;
  address: string;
  purpose: GoogleLinkPurpose;
  googleAccount: GoogleAccountPayload;
  oauthGrant: GoogleOAuthGrantPayload | null;
  createdAt: number;
};

type GoogleIdTokenPayload = {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  picture?: unknown;
};

type GoogleOAuthTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  id_token?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
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

function getGoogleOAuthOptions(purpose: GoogleLinkPurpose) {
  if (purpose === "forms_response_access") {
    return {
      requestedScopes: [...GOOGLE_IDENTITY_SCOPES, GOOGLE_FORMS_RESPONSES_SCOPE],
      needsOfflineAccess: true,
      promptConsent: true,
    };
  }

  return {
    requestedScopes: [...GOOGLE_IDENTITY_SCOPES],
    needsOfflineAccess: false,
    promptConsent: false,
  };
}

function splitGrantedScopes(value: unknown) {
  if (typeof value !== "string") {
    return [] as string[];
  }

  return value
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function parseOptionalIsoString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

export function normalizeGoogleLinkPurpose(value: unknown): GoogleLinkPurpose {
  return value === "forms_response_access" ? value : "identity_link";
}

export function buildWalletActionNonce(address: string, purpose = "wallet-action") {
  return `freight-${purpose}:${normalizeAddress(address)}:${randomToken(18)}`;
}

export function walletActionNonceMatchesPurpose(nonce: string, purpose: string, address?: string | null) {
  const normalizedPurpose = purpose.trim().toLowerCase();
  const normalizedAddress = address ? normalizeAddress(address) : null;
  const prefix = `freight-${normalizedPurpose}:`;
  if (!nonce.startsWith(prefix)) {
    return false;
  }

  if (!normalizedAddress) {
    return true;
  }

  return nonce.startsWith(`${prefix}${normalizedAddress}:`);
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

export function buildGoogleNonce(address: string, purpose: GoogleLinkPurpose = "identity_link") {
  return `freight-google-link:${purpose}:${normalizeAddress(address)}:${randomToken(18)}`;
}

export function googleNonceMatchesPurpose(nonce: string, purpose: GoogleLinkPurpose, address?: string | null) {
  const normalizedPurpose = normalizeGoogleLinkPurpose(purpose);
  const normalizedAddress = address ? normalizeAddress(address) : null;
  const prefix = `freight-google-link:${normalizedPurpose}:`;
  if (!nonce.startsWith(prefix)) {
    return false;
  }

  if (!normalizedAddress) {
    return true;
  }

  return nonce.startsWith(`${prefix}${normalizedAddress}:`);
}

export function createGoogleOAuthState(params: {
  address: string;
  nonce: string;
  redirectPath?: string | null;
  purpose?: GoogleLinkPurpose;
}) {
  cleanExpiredGoogleOAuthStates();
  const purpose = normalizeGoogleLinkPurpose(params.purpose);
  const options = getGoogleOAuthOptions(purpose);
  const state = randomToken(24);
  const record: GoogleOAuthStateRecord = {
    address: normalizeAddress(params.address),
    nonce: params.nonce,
    state,
    createdAt: nowMs(),
    redirectPath: params.redirectPath?.trim() || "/",
    purpose,
    requestedScopes: options.requestedScopes,
    needsOfflineAccess: options.needsOfflineAccess,
    promptConsent: options.promptConsent,
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

export function buildGoogleAuthorizeUrl(record: Pick<GoogleOAuthStateRecord, "state" | "requestedScopes" | "needsOfflineAccess" | "promptConsent">) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) {
    throw new Error("Missing Google OAuth environment variables");
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", record.requestedScopes.join(" "));
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", record.state);
  url.searchParams.set("prompt", record.promptConsent ? "consent" : "select_account");
  if (record.needsOfflineAccess) {
    url.searchParams.set("access_type", "offline");
  } else {
    url.searchParams.set("access_type", "online");
  }
  return url.toString();
}

function parseWalletIdentity(identity: string, signType: SignerSignType):
  | { publicKey: string }
  | { keyType: CredentialKeyType; publicKey: string } {
  if (signType !== SignerSignType.JoyId) {
    return { publicKey: identity };
  }

  const parsed = JSON.parse(identity) as { keyType?: unknown; publicKey?: unknown };
  if (typeof parsed.publicKey !== "string" || !parsed.publicKey.trim()) {
    throw new Error("JoyID signature identity is missing a public key");
  }
  if (typeof parsed.keyType !== "string" || !parsed.keyType.trim()) {
    throw new Error("JoyID signature identity is missing a key type");
  }

  return {
    keyType: parsed.keyType.trim() as CredentialKeyType,
    publicKey: parsed.publicKey.trim(),
  };
}

function parseJoyIdSignaturePayload(signature: string): { alg: SigningAlg; message?: unknown; signature?: unknown } {
  const parsed = JSON.parse(signature) as { alg?: unknown; message?: unknown; signature?: unknown };
  if (parsed.alg !== -257 && parsed.alg !== -7) {
    throw new Error("JoyID signature payload is missing alg");
  }

  return {
    ...parsed,
    alg: parsed.alg,
  };
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
  console.log("[wallet-seed] verifyWalletSignature input", {
    address: params.address,
    nonce: params.nonce,
    signature: {
      identity: params.signature.identity,
      signType: params.signature.signType,
      signaturePreview: `${params.signature.signature.slice(0, 14)}…${params.signature.signature.slice(-10)}`,
    },
  });

  const parsedIdentity = parseWalletIdentity(params.signature.identity, params.signature.signType);
  const expectedAddress = normalizeAddress(params.address);

  let derivedAddress = expectedAddress;
  if (params.signature.signType === SignerSignType.JoyId) {
    if (!("keyType" in parsedIdentity)) {
      throw new Error("JoyID signature identity is missing a key type");
    }

    const joyIdSignature = parseJoyIdSignaturePayload(params.signature.signature);
    const credentialMatches = await verifyCredential(
      {
        address: expectedAddress,
        alg: joyIdSignature.alg,
        keyType: parsedIdentity.keyType,
        pubkey: parsedIdentity.publicKey,
      },
      joyidServerUrl,
    );

    console.log("[wallet-seed] verifyWalletSignature JoyID credential match", {
      credentialMatches,
      expectedAddress,
      keyType: parsedIdentity.keyType,
      publicKeyPreview: `${parsedIdentity.publicKey.slice(0, 12)}…${parsedIdentity.publicKey.slice(-12)}`,
      alg: joyIdSignature.alg,
    });

    if (!credentialMatches) {
      throw new Error("JoyID credential does not match the provided address");
    }
  } else {
    const signer = new SignerCkbPublicKey(getPublicCkbClient(), parsedIdentity.publicKey);
    const addressObj = await signer.getRecommendedAddressObj();
    derivedAddress = normalizeAddress(addressObj.toString());
  }

  console.log("[wallet-seed] verifyWalletSignature derived address", {
    derivedAddress,
    expectedAddress,
  });

  if (derivedAddress !== expectedAddress) {
    throw new Error("Wallet signature identity does not match the provided address");
  }

  const verified = await Signer.verifyMessage(params.nonce, new Signature(
    params.signature.signature,
    params.signature.identity,
    params.signature.signType,
  ));

  console.log("[wallet-seed] verifyWalletSignature verified", {
    verified,
  });

  if (!verified) {
    throw new Error("Wallet signature verification failed");
  }
}

function parseGoogleAccountFromIdToken(idToken: string) {
  const segments = idToken.split(".");
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
  } satisfies GoogleAccountPayload;
}

export async function exchangeGoogleCodeForLinkResult(
  code: string,
  fallbackScopes: readonly string[] = GOOGLE_IDENTITY_SCOPES,
) {
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

  const tokenPayload = await tokenResponse.json().catch(() => null) as GoogleOAuthTokenResponse | null;
  const idToken = typeof tokenPayload?.id_token === "string" ? tokenPayload.id_token : null;
  if (!tokenResponse.ok || !idToken || !tokenPayload) {
    throw new Error(
      typeof tokenPayload?.error_description === "string"
        ? tokenPayload.error_description
        : typeof tokenPayload?.error === "string"
          ? tokenPayload.error
          : "Failed to complete Google OAuth",
    );
  }

  const expiresIn = typeof tokenPayload.expires_in === "number"
    ? tokenPayload.expires_in
    : typeof tokenPayload.expires_in === "string"
      ? Number(tokenPayload.expires_in)
      : null;
  const accessToken = typeof tokenPayload.access_token === "string" ? tokenPayload.access_token : null;
  const accessTokenExpiresAt = accessToken && typeof expiresIn === "number" && Number.isFinite(expiresIn)
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const grantedScopes = splitGrantedScopes(tokenPayload.scope);

  return {
    googleAccount: parseGoogleAccountFromIdToken(idToken),
    accessToken,
    accessTokenExpiresAt,
    refreshToken: typeof tokenPayload.refresh_token === "string" ? tokenPayload.refresh_token : null,
    grantedScopes: grantedScopes.length > 0 ? grantedScopes : [...fallbackScopes],
    tokenType: typeof tokenPayload.token_type === "string" ? tokenPayload.token_type : null,
  };
}

export function hasGoogleFormsResponsesScope(scopes: readonly string[]) {
  return scopes.includes(GOOGLE_FORMS_RESPONSES_SCOPE);
}

export function buildGoogleOAuthGrant(params: {
  grantKind: GoogleOAuthGrantKind;
  address: string;
  googleAccount: GoogleAccountPayload;
  grantedScopes: string[];
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  refreshToken: string | null;
  tokenType: string | null;
  existingGrant?: GoogleOAuthGrantPayload | null;
}) {
  const now = new Date().toISOString();
  return {
    grantKind: params.grantKind,
    googleAccount: {
      ...params.googleAccount,
      linkedAt: params.existingGrant?.googleAccount.linkedAt ?? params.googleAccount.linkedAt,
      lastRefreshedAt: now,
    },
    scopes: Array.from(new Set(params.grantedScopes.filter(Boolean))),
    accessToken: params.accessToken,
    accessTokenExpiresAt: params.accessTokenExpiresAt,
    refreshToken: params.refreshToken ?? params.existingGrant?.refreshToken ?? null,
    tokenType: params.tokenType,
    linkedAt: params.existingGrant?.linkedAt ?? now,
    lastRefreshedAt: now,
  } satisfies GoogleOAuthGrantPayload;
}

export function parseStoredGoogleOAuthGrant(value: unknown): GoogleOAuthGrantPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    grantKind?: unknown;
    googleAccount?: unknown;
    scopes?: unknown;
    accessToken?: unknown;
    accessTokenExpiresAt?: unknown;
    refreshToken?: unknown;
    tokenType?: unknown;
    linkedAt?: unknown;
    lastRefreshedAt?: unknown;
  };

  if (candidate.grantKind !== "forms_response_access") {
    return null;
  }

  const googleAccount = parseGoogleAccountPayload(candidate.googleAccount);
  if (!googleAccount) {
    return null;
  }

  return {
    grantKind: "forms_response_access",
    googleAccount,
    scopes: Array.isArray(candidate.scopes)
      ? candidate.scopes.filter((scope): scope is string => typeof scope === "string" && scope.trim().length > 0)
      : [],
    accessToken: typeof candidate.accessToken === "string" ? candidate.accessToken : null,
    accessTokenExpiresAt: parseOptionalIsoString(candidate.accessTokenExpiresAt),
    refreshToken: typeof candidate.refreshToken === "string" ? candidate.refreshToken : null,
    tokenType: typeof candidate.tokenType === "string" ? candidate.tokenType : null,
    linkedAt: parseOptionalIsoString(candidate.linkedAt) ?? googleAccount.linkedAt,
    lastRefreshedAt: parseOptionalIsoString(candidate.lastRefreshedAt) ?? googleAccount.lastRefreshedAt,
  };
}

export function sanitizeGoogleOAuthGrantSummary(grant: GoogleOAuthGrantPayload | null): GoogleOAuthGrantSummary | null {
  if (!grant) {
    return null;
  }

  return {
    grantKind: grant.grantKind,
    email: grant.googleAccount.email,
    linkedAt: grant.linkedAt,
    lastRefreshedAt: grant.lastRefreshedAt,
    scopes: [...grant.scopes],
    hasRefreshToken: Boolean(grant.refreshToken),
  };
}

export function isGoogleAccessTokenCurrent(grant: GoogleOAuthGrantPayload | null) {
  if (!grant?.accessToken || !grant.accessTokenExpiresAt) {
    return false;
  }

  const expiresAt = Date.parse(grant.accessTokenExpiresAt);
  if (!Number.isFinite(expiresAt)) {
    return false;
  }

  return expiresAt - Date.now() > GOOGLE_ACCESS_TOKEN_REFRESH_SKEW_MS;
}

export async function refreshGoogleGrantAccessToken(grant: GoogleOAuthGrantPayload) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Missing Google OAuth environment variables");
  }

  if (!grant.refreshToken) {
    throw new Error("Google response-access grant is missing a refresh token. Reconnect Google access and try again.");
  }

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: grant.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const tokenPayload = await tokenResponse.json().catch(() => null) as GoogleOAuthTokenResponse | null;
  const accessToken = typeof tokenPayload?.access_token === "string" ? tokenPayload.access_token : null;
  if (!tokenResponse.ok || !accessToken || !tokenPayload) {
    throw new Error(
      typeof tokenPayload?.error_description === "string"
        ? tokenPayload.error_description
        : typeof tokenPayload?.error === "string"
          ? tokenPayload.error
          : "Failed to refresh Google API access",
    );
  }

  const expiresIn = typeof tokenPayload.expires_in === "number"
    ? tokenPayload.expires_in
    : typeof tokenPayload.expires_in === "string"
      ? Number(tokenPayload.expires_in)
      : null;
  const accessTokenExpiresAt = typeof expiresIn === "number" && Number.isFinite(expiresIn)
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  return {
    accessToken,
    accessTokenExpiresAt,
    refreshToken: typeof tokenPayload.refresh_token === "string" ? tokenPayload.refresh_token : grant.refreshToken,
    grantedScopes: splitGrantedScopes(tokenPayload.scope).length > 0 ? splitGrantedScopes(tokenPayload.scope) : grant.scopes,
    tokenType: typeof tokenPayload.token_type === "string" ? tokenPayload.token_type : grant.tokenType,
  };
}

function parseGoogleAccountPayload(value: unknown): GoogleAccountPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    sub?: unknown;
    email?: unknown;
    emailVerified?: unknown;
    picture?: unknown;
    linkedAt?: unknown;
    lastRefreshedAt?: unknown;
  };

  if (typeof candidate.sub !== "string" || typeof candidate.email !== "string") {
    return null;
  }

  return {
    sub: candidate.sub.trim(),
    email: candidate.email.trim().toLowerCase(),
    emailVerified: candidate.emailVerified === true,
    picture: typeof candidate.picture === "string" ? candidate.picture : null,
    linkedAt: parseOptionalIsoString(candidate.linkedAt) ?? new Date().toISOString(),
    lastRefreshedAt: parseOptionalIsoString(candidate.lastRefreshedAt) ?? new Date().toISOString(),
  };
}

export function createGoogleLinkCode(
  address: string,
  googleAccount: GoogleAccountPayload,
  purpose: GoogleLinkPurpose = "identity_link",
  oauthGrant: GoogleOAuthGrantPayload | null = null,
) {
  cleanExpiredGoogleLinkCodes();
  const code = randomBytes(6).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, GOOGLE_LINK_CODE_LENGTH).toUpperCase();
  const record: GoogleLinkCodeRecord = {
    code,
    address: normalizeAddress(address),
    purpose,
    googleAccount,
    oauthGrant,
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
