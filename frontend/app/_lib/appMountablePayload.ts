import { normalizeAppMountableConfig, normalizeAppMountableConfigs } from "@/app/_lib/appMountable";
import type { AppMountableConfig } from "@/app/_types/appMountable";
import { deriveMountableWindow } from "@/lib/mountableTiming";

type EnsureAppMountablesArgs = {
  baseTimestamp?: string | number | Date | null;
  taskStartDelayHours?: string | null;
  taskDurationHours?: string | null;
};

export function ensureOptionalAppMountables(value: unknown, args: EnsureAppMountablesArgs): AppMountableConfig[] {
  const normalizedApps = normalizeAppMountableConfigs(value);
  if (normalizedApps.length === 0) {
    return [];
  }

  const seenAppKeys = new Set<string>();
  const seenInstanceIds = new Set<string>();

  return normalizedApps.map((entry, index) => {
    const hasCanonicalBaseTimestamp = args.baseTimestamp !== null
      && args.baseTimestamp !== undefined
      && String(args.baseTimestamp).trim().length > 0;
    const derivedWindow = deriveMountableWindow({
      startsAt: hasCanonicalBaseTimestamp ? null : entry.startsAt,
      endsAt: hasCanonicalBaseTimestamp ? null : entry.endsAt,
      taskStartDelayHours: args.taskStartDelayHours,
      taskDurationHours: args.taskDurationHours,
      baseTimestamp: args.baseTimestamp,
    });
    const normalized = normalizeAppMountableConfig({
      ...entry,
      startsAt: hasCanonicalBaseTimestamp ? derivedWindow.startsAt : entry.startsAt || derivedWindow.startsAt,
      endsAt: hasCanonicalBaseTimestamp ? derivedWindow.endsAt : entry.endsAt || derivedWindow.endsAt,
      webhookSecretExpiresAt: hasCanonicalBaseTimestamp ? derivedWindow.endsAt : entry.webhookSecretExpiresAt,
    });

    if (!normalized.enabled) {
      return normalized;
    }

    if (!normalized.appId) {
      throw new Error(`mountables.apps[${index}].appId is required`);
    }

    if (!normalized.appName) {
      throw new Error(`mountables.apps[${index}].appName is required`);
    }

    if (!normalized.logoUrl) {
      throw new Error(`mountables.apps[${index}].logoUrl is required`);
    }

    if (!normalized.mountableInstanceId) {
      throw new Error(`mountables.apps[${index}].mountableInstanceId is required`);
    }

    if (normalized.selectedPrinciples.length === 0) {
      throw new Error(`mountables.apps[${index}] must include at least one selected principle`);
    }

    const appKey = `${normalized.appId}:${normalized.installationId || normalized.mountableInstanceId}`;
    if (seenAppKeys.has(appKey)) {
      throw new Error(`mountables.apps[${index}] duplicates an existing mounted app`);
    }
    seenAppKeys.add(appKey);

    if (seenInstanceIds.has(normalized.mountableInstanceId)) {
      throw new Error(`mountables.apps[${index}].mountableInstanceId must be unique`);
    }
    seenInstanceIds.add(normalized.mountableInstanceId);

    return normalized;
  });
}
