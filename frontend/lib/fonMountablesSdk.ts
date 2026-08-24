export type MountableJsonPrimitive = boolean | number | string | null;
export type MountableJsonValue = MountableJsonPrimitive | MountableJsonValue[] | MountableJsonObject;
export type MountableJsonObject = {
  [key: string]: MountableJsonValue;
};

export type MountableAppPrincipleDefinition = {
  principleId: string;
  title: string;
  description: string;
  supportsTimestampQuery: boolean;
};

export type RegisteredMountableAppManifest = {
  appId: string;
  appName: string;
  description: string;
  sdkVersion: string;
  appUrl: string;
  iconUrl: string;
  verifyInstallUrl: string;
  supportsTimestampQuery: boolean;
  principles: MountableAppPrincipleDefinition[];
  configSchema: MountableJsonObject;
  configDefaults: MountableJsonObject;
};

export type VerifyMountableAppCampaignContext = {
  campaignId: string | null;
  createdByHash: string | null;
  chainCreatedAt: string | null;
  campaignType: number | null;
  taskStartDelayHours: string | null;
  taskDurationHours: string | null;
  startsAt: string | null;
  endsAt: string | null;
};

export type VerifyMountableAppRequest = {
  appId: string;
  installToken: string;
  selectedPrincipleIds?: string[];
  config?: MountableJsonObject;
  campaign?: VerifyMountableAppCampaignContext;
};

export type VerifyMountableAppResult = {
  installationId?: string;
  installationLabel?: string;
  appUrl?: string;
  iconUrl?: string;
  description?: string;
  supportsTimestampQuery?: boolean;
  principles?: MountableAppPrincipleDefinition[];
  config?: MountableJsonObject;
  sharedSecret?: string;
  adminNotice?: string;
};

export type MountedAppPrincipleState = {
  principleId: string;
  fulfilled: boolean;
  detail?: string;
  updatedAt?: string;
};

export type MountedAppUpdatePayload = {
  appId: string;
  campaignId: string;
  participantAddress: string;
  principleStates: MountedAppPrincipleState[];
  effectiveAt: string;
  sourceUpdatedAt: string;
  statusMessage?: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeMountableAppId(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeMountableUrl(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
}

export function normalizeIsoTimestamp(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

export function normalizeMountableJsonValue(value: unknown): MountableJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeMountableJsonValue(entry));
  }

  if (!isPlainObject(value)) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, normalizeMountableJsonValue(entry)]),
  );
}

export function normalizeMountableJsonObject(value: unknown): MountableJsonObject {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, normalizeMountableJsonValue(entry)]),
  );
}

export function normalizeMountableAppPrinciples(value: unknown): MountableAppPrincipleDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: MountableAppPrincipleDefinition[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as {
      principleId?: unknown;
      title?: unknown;
      description?: unknown;
      supportsTimestampQuery?: unknown;
    };

    const principleId = normalizeMountableAppId(typeof candidate.principleId === "string" ? candidate.principleId : "");
    if (!principleId || seen.has(principleId)) {
      continue;
    }

    const title = typeof candidate.title === "string" && candidate.title.trim()
      ? candidate.title.trim()
      : principleId;

    normalized.push({
      principleId,
      title,
      description: typeof candidate.description === "string" ? candidate.description.trim() : "",
      supportsTimestampQuery: candidate.supportsTimestampQuery === true,
    });
    seen.add(principleId);
  }

  return normalized;
}

export function selectMountableAppPrinciples(
  principles: MountableAppPrincipleDefinition[],
  selectedPrincipleIds: string[] | null | undefined,
) {
  if (!Array.isArray(selectedPrincipleIds) || selectedPrincipleIds.length === 0) {
    return [] as MountableAppPrincipleDefinition[];
  }

  const selectedIdSet = new Set(
    selectedPrincipleIds
      .map((value) => normalizeMountableAppId(value))
      .filter(Boolean),
  );

  return principles.filter((principle) => selectedIdSet.has(principle.principleId));
}

export async function hashMountableSecret(secret: string) {
  const encoded = new TextEncoder().encode(secret.trim());
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export function maskInstallToken(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.length <= 6) {
    return `${trimmed.slice(0, 1)}***`;
  }

  return `${trimmed.slice(0, 3)}***${trimmed.slice(-2)}`;
}
