import type {
  AppMountableConfig,
  AppMountableSelectedPrinciple,
  MountableAppStatus,
} from "@/app/_types/appMountable";
import {
  formatMountableAppPrincipleSelection,
  normalizeIsoTimestamp,
  normalizeMountableAppId,
  normalizeMountableAppPrinciples,
  normalizeMountableAppPrincipleSelections,
  normalizeMountableJsonObject,
  normalizeMountableUrl,
  resolveSelectedMountableAppPrinciples,
} from "@/lib/fonMountablesSdk";

export const DEFAULT_APP_MOUNTABLE_CONFIG: AppMountableConfig = {
  enabled: false,
  appId: "",
  appName: "",
  description: "",
  sdkVersion: "",
  appUrl: "",
  iconUrl: "",
  mountableInstanceId: "",
  installationId: "",
  installationLabel: "",
  installTokenMasked: "",
  installTokenUpdatedAt: "",
  status: "pending",
  verifiedAt: "",
  supportsTimestampQuery: false,
  activityWebhookUrl: "",
  pollUpdatesUrl: "",
  syncMode: "webhook",
  pollIntervalSeconds: null,
  registrationSecretIssuedAt: "",
  startsAt: "",
  endsAt: "",
  principles: [],
  selectedPrinciples: [],
  config: {},
  adminNotice: "",
  installationSecretHash: "",
  lastSyncAt: "",
};

export function normalizeAppMountableStatus(value: unknown): MountableAppStatus {
  return value === "verified" || value === "syncing" || value === "pending"
    ? value
    : "pending";
}

function normalizeSelectedPrinciples(
  principles: AppMountableConfig["principles"],
  selectedValue: unknown,
): AppMountableSelectedPrinciple[] {
  const normalizedSelected = normalizeMountableAppPrincipleSelections(selectedValue);

  if (principles.length === 0) {
    return normalizedSelected.map((principle) => ({
      principleId: principle.principleId,
      title: principle.displayLabel?.trim() || principle.principleId,
      description: "",
      supportsTimestampQuery: false,
      paramsSchema: [],
      paramsDefaults: {},
      readableFormat: "",
      exampleReadableText: principle.displayLabel?.trim() || principle.principleId,
      params: normalizeMountableJsonObject(principle.params),
      displayLabel: principle.displayLabel?.trim() || principle.principleId,
      required: principle.required !== false,
    }));
  }

  const selectedFromPrinciples = resolveSelectedMountableAppPrinciples(principles, normalizedSelected);
  if (selectedFromPrinciples.length === 0) {
    return [];
  }

  return selectedFromPrinciples.map((principle) => ({
    ...principle,
    displayLabel: principle.displayLabel || formatMountableAppPrincipleSelection(principle, principle.params),
    required: principle.required !== false,
  }));
}

export function normalizeAppMountableConfig(value: Partial<AppMountableConfig> | null | undefined): AppMountableConfig {
  const principles = normalizeMountableAppPrinciples(value?.principles);
  const selectedPrinciples = normalizeSelectedPrinciples(principles, value?.selectedPrinciples);

  return {
    enabled: Boolean(value?.enabled),
    appId: normalizeMountableAppId(typeof value?.appId === "string" ? value.appId : ""),
    appName: typeof value?.appName === "string" ? value.appName.trim() : "",
    description: typeof value?.description === "string" ? value.description.trim() : "",
    sdkVersion: typeof value?.sdkVersion === "string" ? value.sdkVersion.trim() : "",
    appUrl: normalizeMountableUrl(typeof value?.appUrl === "string" ? value.appUrl : ""),
    iconUrl: normalizeMountableUrl(typeof value?.iconUrl === "string" ? value.iconUrl : ""),
    mountableInstanceId: typeof value?.mountableInstanceId === "string" ? value.mountableInstanceId.trim() : "",
    installationId: typeof value?.installationId === "string" ? value.installationId.trim() : "",
    installationLabel: typeof value?.installationLabel === "string" ? value.installationLabel.trim() : "",
    installTokenMasked: typeof value?.installTokenMasked === "string" ? value.installTokenMasked.trim() : "",
    installTokenUpdatedAt: normalizeIsoTimestamp(value?.installTokenUpdatedAt),
    status: normalizeAppMountableStatus(value?.status),
    verifiedAt: normalizeIsoTimestamp(value?.verifiedAt),
    supportsTimestampQuery: value?.supportsTimestampQuery === true,
    activityWebhookUrl: normalizeMountableUrl(typeof value?.activityWebhookUrl === "string" ? value.activityWebhookUrl : ""),
    pollUpdatesUrl: normalizeMountableUrl(typeof value?.pollUpdatesUrl === "string" ? value.pollUpdatesUrl : ""),
    syncMode: value?.syncMode === "poll" || value?.syncMode === "both" ? value.syncMode : "webhook",
    pollIntervalSeconds: typeof value?.pollIntervalSeconds === "number" && Number.isFinite(value.pollIntervalSeconds) ? value.pollIntervalSeconds : null,
    registrationSecretIssuedAt: normalizeIsoTimestamp(value?.registrationSecretIssuedAt),
    startsAt: normalizeIsoTimestamp(value?.startsAt),
    endsAt: normalizeIsoTimestamp(value?.endsAt),
    principles,
    selectedPrinciples,
    config: normalizeMountableJsonObject(value?.config),
    adminNotice: typeof value?.adminNotice === "string" ? value.adminNotice.trim() : "",
    installationSecretHash: typeof value?.installationSecretHash === "string" ? value.installationSecretHash.trim().toLowerCase() : "",
    lastSyncAt: normalizeIsoTimestamp(value?.lastSyncAt),
  };
}

export function normalizeAppMountableConfigs(value: unknown): AppMountableConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => normalizeAppMountableConfig(entry)).filter((entry) => entry.appId.length > 0);
}

export function isAppMountableEnabled(value: Partial<AppMountableConfig> | null | undefined) {
  const normalized = normalizeAppMountableConfig(value);
  return normalized.enabled && normalized.appId.length > 0 && normalized.selectedPrinciples.length > 0;
}

export function appMountableSummary(config: AppMountableConfig) {
  if (!isAppMountableEnabled(config)) {
    return "No mounted app configured.";
  }

  const selectedCount = config.selectedPrinciples.length;
  const timestampNote = config.supportsTimestampQuery ? "timestamp-aware" : "latest-only";
  const installationLabel = config.installationLabel || config.installationId || config.mountableInstanceId;

  return `${config.appName || config.appId} • ${selectedCount} selected principle(s) • ${timestampNote}${installationLabel ? ` • ${installationLabel}` : ""}`;
}

export function getAppMountableSelectedPrincipleIds(config: Partial<AppMountableConfig> | null | undefined) {
  return normalizeAppMountableConfig(config).selectedPrinciples.map((principle) => principle.principleId);
}
