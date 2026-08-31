export type MountableJsonPrimitive = boolean | number | string | null;
export type MountableJsonValue = MountableJsonPrimitive | MountableJsonValue[] | MountableJsonObject;
export type MountableJsonObject = {
  [key: string]: MountableJsonValue;
};

export type MountableAppSyncMode = "webhook" | "poll" | "both";

export type MountableAppPrincipleParamValueType = "string" | "number" | "boolean" | "enum";

export type MountableAppPrincipleParamOption = {
  value: string;
  label: string;
  description: string;
};

export type MountableAppPrincipleParamDefinition = {
  paramKey: string;
  title: string;
  description: string;
  valueType: MountableAppPrincipleParamValueType;
  required: boolean;
  defaultValue?: MountableJsonValue;
  enumOptions?: MountableAppPrincipleParamOption[];
  minimum?: number | null;
  maximum?: number | null;
  step?: number | null;
  placeholder?: string;
};

export type MountableAppPrincipleDefinition = {
  principleId: string;
  title: string;
  description: string;
  supportsTimestampQuery: boolean;
  paramsSchema: MountableAppPrincipleParamDefinition[];
  paramsDefaults: MountableJsonObject;
  readableFormat: string;
  exampleReadableText: string;
};

export type MountableAppPrincipleSelection = {
  principleId: string;
  params?: MountableJsonObject;
  displayLabel?: string;
  required?: boolean;
};

export type ResolvedMountableAppPrincipleSelection = MountableAppPrincipleDefinition & {
  params: MountableJsonObject;
  displayLabel: string;
  required: boolean;
};

export type RegisteredMountableAppManifest = {
  appId: string;
  appName: string;
  description: string;
  sdkVersion: string;
  appUrl: string;
  iconUrl: string;
  verifyInstallUrl: string;
  activityWebhookUrl: string;
  pollUpdatesUrl: string;
  syncMode: MountableAppSyncMode;
  pollIntervalSeconds: number | null;
  supportsTimestampQuery: boolean;
  principles: MountableAppPrincipleDefinition[];
  configSchema: MountableJsonObject;
  configDefaults: MountableJsonObject;
  registrationSecretIssuedAt?: string;
};

export type RegisterMountableAppRequest = RegisteredMountableAppManifest & {
  rotateRegistrationSecret?: boolean;
};

export type RegisterMountableAppResult = {
  ok: true;
  appId: string;
  appName: string;
  principles: MountableAppPrincipleDefinition[];
  registrationSecret: string;
  activityWebhookUrl: string;
  pollUpdatesUrl: string;
  syncMode: MountableAppSyncMode;
  pollIntervalSeconds: number | null;
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
  selectedPrinciples?: MountableAppPrincipleSelection[];
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
  selectedPrinciples?: MountableAppPrincipleSelection[];
  config?: MountableJsonObject;
  sharedSecret?: string;
  adminNotice?: string;
};

export type EvaluateMountableAppParticipantContext = {
  participantAddress: string;
  participantHandle?: string | null;
  externalUserId?: string | null;
};

export type EvaluateMountableAppFreightContext = VerifyMountableAppCampaignContext & {
  asOf?: string | null;
};

export type EvaluateMountableAppPrincipleRequest = {
  appId: string;
  principleId: string;
  params?: MountableJsonObject;
  participant: EvaluateMountableAppParticipantContext;
  freight?: EvaluateMountableAppFreightContext;
};

export type MountedAppPrincipleState = {
  principleId: string;
  title?: string;
  description?: string;
  supportsTimestampQuery?: boolean;
  params?: MountableJsonObject;
  displayLabel?: string;
  fulfilled: boolean;
  detail?: string;
  updatedAt?: string;
};

export type EvaluateMountableAppPrincipleResult = MountedAppPrincipleState;

export type MountableAppPrincipleHandler = {
  definition: MountableAppPrincipleDefinition;
  formatSelection?: (params: MountableJsonObject) => string;
  evaluate: (request: EvaluateMountableAppPrincipleRequest) => Promise<EvaluateMountableAppPrincipleResult> | EvaluateMountableAppPrincipleResult;
};

export interface FonMountableHostedAppSdk {
  addPrinciple(definition: MountableAppPrincipleDefinition, handler: Omit<MountableAppPrincipleHandler, "definition">): this;
  evaluatePrinciple(request: EvaluateMountableAppPrincipleRequest): Promise<EvaluateMountableAppPrincipleResult>;
  listPrinciples(): MountableAppPrincipleDefinition[];
}

export type MountedAppUpdatePayload = {
  appId: string;
  campaignId: string;
  participantAddress: string;
  principleStates: MountedAppPrincipleState[];
  effectiveAt: string;
  sourceUpdatedAt: string;
  statusMessage?: string;
};

export type MountedAppActivityEventType = "participant.updated" | "participant.finalized" | "mounted-app.verified";

export type MountedAppActivityParticipantSnapshot = {
  participantAddress: string;
  participantKind?: string | null;
  status: string;
  mountableType?: string | null;
  mountableInstanceId?: string | null;
  childSatisfied?: boolean | null;
  parentSatisfied?: boolean | null;
  statusMessage?: string | null;
  effectiveAt?: string | null;
  sourceUpdatedAt?: string | null;
  criteriaState?: MountableJsonValue[];
};

export type MountedAppCanonicalVerificationSnapshot = {
  status: "pending" | "verified";
  formsSatisfied: boolean;
  appPrinciplesSatisfied: boolean;
  baseParticipationSatisfied: boolean;
  verifiedAt?: string | null;
  reasons: string[];
};

export type MountedAppActivityEvent = {
  eventId: string;
  eventType: MountedAppActivityEventType;
  appId: string;
  mountableInstanceId: string;
  occurredAt: string;
  freight: VerifyMountableAppCampaignContext;
  selectedPrinciples: MountableAppPrincipleSelection[];
  participant?: MountedAppActivityParticipantSnapshot;
  canonicalVerification?: MountedAppCanonicalVerificationSnapshot;
  source?: string;
};

export type PollMountableAppRequest = {
  appId: string;
  mountableInstanceId: string;
  freight: VerifyMountableAppCampaignContext;
  selectedPrinciples: MountableAppPrincipleSelection[];
  participants: MountedAppActivityParticipantSnapshot[];
  asOf?: string | null;
};

export type PollMountableAppResult = {
  updates: MountedAppUpdatePayload[];
  polledAt?: string;
  adminNotice?: string;
};

type MountableAppPrincipleLike = MountableAppPrincipleDefinition | ResolvedMountableAppPrincipleSelection;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeFiniteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function normalizeMountableAppSyncMode(value: unknown): MountableAppSyncMode {
  return value === "poll" || value === "both" || value === "webhook"
    ? value
    : "webhook";
}

export function normalizeMountablePositiveInteger(value: unknown): number | null {
  const normalized = normalizeFiniteNumber(value);
  if (normalized === null) {
    return null;
  }

  const rounded = Math.round(normalized);
  return rounded > 0 ? rounded : null;
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

export function normalizeMountableAppPrincipleParamOptions(value: unknown): MountableAppPrincipleParamOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: MountableAppPrincipleParamOption[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as {
      value?: unknown;
      label?: unknown;
      description?: unknown;
    };
    const optionValue = typeof candidate.value === "string" ? candidate.value.trim() : "";
    if (!optionValue) {
      continue;
    }

    normalized.push({
      value: optionValue,
      label: typeof candidate.label === "string" && candidate.label.trim() ? candidate.label.trim() : optionValue,
      description: typeof candidate.description === "string" ? candidate.description.trim() : "",
    });
  }

  return normalized;
}

export function normalizeMountableAppPrincipleParamsSchema(value: unknown): MountableAppPrincipleParamDefinition[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: MountableAppPrincipleParamDefinition[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as {
      paramKey?: unknown;
      title?: unknown;
      description?: unknown;
      valueType?: unknown;
      required?: unknown;
      defaultValue?: unknown;
      enumOptions?: unknown;
      minimum?: unknown;
      maximum?: unknown;
      step?: unknown;
      placeholder?: unknown;
    };

    const paramKey = normalizeMountableAppId(typeof candidate.paramKey === "string" ? candidate.paramKey : "");
    if (!paramKey || seen.has(paramKey)) {
      continue;
    }

    const valueType = candidate.valueType === "number"
      || candidate.valueType === "boolean"
      || candidate.valueType === "enum"
      ? candidate.valueType
      : "string";

    normalized.push({
      paramKey,
      title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title.trim() : paramKey,
      description: typeof candidate.description === "string" ? candidate.description.trim() : "",
      valueType,
      required: candidate.required !== false,
      defaultValue: normalizeMountableJsonValue(candidate.defaultValue),
      enumOptions: valueType === "enum" ? normalizeMountableAppPrincipleParamOptions(candidate.enumOptions) : [],
      minimum: normalizeFiniteNumber(candidate.minimum),
      maximum: normalizeFiniteNumber(candidate.maximum),
      step: normalizeFiniteNumber(candidate.step),
      placeholder: typeof candidate.placeholder === "string" ? candidate.placeholder.trim() : "",
    });
    seen.add(paramKey);
  }

  return normalized;
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
      paramsSchema?: unknown;
      paramsDefaults?: unknown;
      readableFormat?: unknown;
      exampleReadableText?: unknown;
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
      paramsSchema: normalizeMountableAppPrincipleParamsSchema(candidate.paramsSchema),
      paramsDefaults: normalizeMountableJsonObject(candidate.paramsDefaults),
      readableFormat: typeof candidate.readableFormat === "string" ? candidate.readableFormat.trim() : "",
      exampleReadableText: typeof candidate.exampleReadableText === "string" ? candidate.exampleReadableText.trim() : title,
    });
    seen.add(principleId);
  }

  return normalized;
}

export function formatMountableAppPrincipleSelection(
  principle: MountableAppPrincipleDefinition,
  params: MountableJsonObject | null | undefined,
) {
  const mergedParams = {
    ...principle.paramsDefaults,
    ...normalizeMountableJsonObject(params),
  };

  if (!principle.readableFormat) {
    return principle.title;
  }

  return principle.readableFormat.replace(/\{([a-zA-Z0-9._-]+)\}/g, (_match, key) => {
    const value = mergedParams[key];
    if (value === null || value === undefined) {
      return "";
    }

    if (Array.isArray(value)) {
      return value.map((entry) => String(entry ?? "")).join(", ");
    }

    if (typeof value === "object") {
      return JSON.stringify(value);
    }

    return String(value);
  }).trim() || principle.title;
}

export function normalizeMountableAppPrincipleSelections(value: unknown): MountableAppPrincipleSelection[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: MountableAppPrincipleSelection[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      const principleId = normalizeMountableAppId(entry);
      if (!principleId) {
        continue;
      }

      normalized.push({ principleId, params: {}, required: true });
      continue;
    }

    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as {
      principleId?: unknown;
      params?: unknown;
      displayLabel?: unknown;
      required?: unknown;
    };
    const principleId = normalizeMountableAppId(typeof candidate.principleId === "string" ? candidate.principleId : "");
    if (!principleId) {
      continue;
    }

    normalized.push({
      principleId,
      params: normalizeMountableJsonObject(candidate.params),
      displayLabel: typeof candidate.displayLabel === "string" ? candidate.displayLabel.trim() : "",
      required: candidate.required !== false,
    });
  }

  return normalized;
}

export function resolveSelectedMountableAppPrinciples(
  principles: MountableAppPrincipleDefinition[],
  value: unknown,
): ResolvedMountableAppPrincipleSelection[] {
  const definitionsById = new Map(principles.map((principle) => [principle.principleId, principle]));
  const requested = normalizeMountableAppPrincipleSelections(value);
  const seen = new Set<string>();
  const resolved: ResolvedMountableAppPrincipleSelection[] = [];

  for (const entry of requested) {
    const definition = definitionsById.get(entry.principleId);
    if (!definition || seen.has(entry.principleId)) {
      continue;
    }

    const params = {
      ...definition.paramsDefaults,
      ...normalizeMountableJsonObject(entry.params),
    };

    resolved.push({
      ...definition,
      params,
      displayLabel: entry.displayLabel?.trim() || formatMountableAppPrincipleSelection(definition, params),
      required: entry.required !== false,
    });
    seen.add(entry.principleId);
  }

  return resolved;
}

export function selectMountableAppPrinciples(
  principles: MountableAppPrincipleDefinition[],
  selectedValue: string[] | MountableAppPrincipleSelection[] | null | undefined,
) {
  const selectedIdSet = new Set(
    normalizeMountableAppPrincipleSelections(selectedValue)
      .map((entry) => entry.principleId)
      .filter(Boolean),
  );

  return principles.filter((principle) => selectedIdSet.has(principle.principleId));
}

export function normalizeMountedAppPrincipleStates(
  value: unknown,
  definitions: MountableAppPrincipleLike[] = [],
): MountedAppPrincipleState[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const definitionsById = new Map(definitions.map((definition) => [definition.principleId, definition]));
  const normalized: MountedAppPrincipleState[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const candidate = entry as {
      principleId?: unknown;
      fulfilled?: unknown;
      detail?: unknown;
      updatedAt?: unknown;
      title?: unknown;
      description?: unknown;
      supportsTimestampQuery?: unknown;
      params?: unknown;
      displayLabel?: unknown;
    };
    const principleId = normalizeMountableAppId(typeof candidate.principleId === "string" ? candidate.principleId : "");
    if (!principleId || seen.has(principleId)) {
      continue;
    }

    const definition = definitionsById.get(principleId);
    const params = normalizeMountableJsonObject(candidate.params ?? (definition && "params" in definition ? definition.params : {}));

    normalized.push({
      principleId,
      title: typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim()
        : definition?.title ?? principleId,
      description: typeof candidate.description === "string"
        ? candidate.description.trim()
        : definition?.description ?? "",
      supportsTimestampQuery: candidate.supportsTimestampQuery === true || definition?.supportsTimestampQuery === true,
      params,
      displayLabel: typeof candidate.displayLabel === "string" && candidate.displayLabel.trim()
        ? candidate.displayLabel.trim()
        : definition
          ? formatMountableAppPrincipleSelection(definition, params)
          : "",
      fulfilled: candidate.fulfilled === true,
      detail: typeof candidate.detail === "string" ? candidate.detail.trim() : "",
      updatedAt: normalizeIsoTimestamp(candidate.updatedAt),
    });
    seen.add(principleId);
  }

  return normalized;
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
