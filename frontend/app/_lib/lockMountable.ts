import type { LockMountableConfig, LockMountableCriterion } from "@/app/_types/lockMountable";

export const LOCK_MOUNTABLE_BYPASS_MULTIPLIER = 3;

export const DEFAULT_LOCK_MOUNTABLE_CONFIG: LockMountableConfig = {
  enabled: false,
  criterion: "fbars",
  minimumFbars: "",
};

export function normalizeLockMountableCriterion(value: unknown): LockMountableCriterion {
  return value === "fbars" ? value : "fbars";
}

export function normalizeLockMountableConfig(value: Partial<LockMountableConfig> | null | undefined): LockMountableConfig {
  return {
    enabled: Boolean(value?.enabled),
    criterion: normalizeLockMountableCriterion(value?.criterion),
    minimumFbars: typeof value?.minimumFbars === "string"
      ? value.minimumFbars
      : value?.minimumFbars === null || value?.minimumFbars === undefined
        ? ""
        : String(value.minimumFbars),
  };
}

export function getLockMountableMinimumFbars(value: Partial<LockMountableConfig> | null | undefined) {
  const normalized = normalizeLockMountableConfig(value);
  const minimumFbars = parseLockMinimumFbars(normalized.minimumFbars);
  return minimumFbars !== null && minimumFbars > 0 ? minimumFbars : null;
}

export function isLockMountableEnabled(value: Partial<LockMountableConfig> | null | undefined) {
  const normalized = normalizeLockMountableConfig(value);
  const minimumFbars = getLockMountableMinimumFbars(normalized);
  return normalized.enabled && minimumFbars !== null;
}

export function getLockMountableBypassFbars(value: Partial<LockMountableConfig> | null | undefined) {
  const minimumFbars = getLockMountableMinimumFbars(value);
  return minimumFbars === null ? null : minimumFbars * LOCK_MOUNTABLE_BYPASS_MULTIPLIER;
}

export function canAccessLockMountable(value: Partial<LockMountableConfig> | null | undefined, viewerFbars?: number | null) {
  if (!isLockMountableEnabled(value)) {
    return true;
  }

  const bypassFbars = getLockMountableBypassFbars(value);
  if (bypassFbars === null) {
    return true;
  }

  if (typeof viewerFbars !== "number" || !Number.isFinite(viewerFbars) || viewerFbars < 0) {
    return false;
  }

  return Math.trunc(viewerFbars) >= bypassFbars;
}

export function parseLockMinimumFbars(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export function isLockMountableThresholdValid(value: unknown, availableFbars?: number) {
  const parsed = parseLockMinimumFbars(value);
  if (parsed === null || parsed <= 0) {
    return false;
  }

  if (typeof availableFbars !== "number" || !Number.isFinite(availableFbars) || availableFbars < 0) {
    return true;
  }

  return parsed <= Math.trunc(availableFbars);
}

export function getLockMountableValidationState(value: unknown, availableFbars?: number): "idle" | "valid" | "invalid" {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return "idle";
  }

  return isLockMountableThresholdValid(value, availableFbars) ? "valid" : "invalid";
}

export function lockMountableSummary(config: LockMountableConfig) {
  if (!isLockMountableEnabled(config)) {
    return "No lock criteria configured.";
  }

  const minimumFbars = parseLockMinimumFbars(config.minimumFbars) ?? 0;
  return `FBARS lock • ${minimumFbars} FBARS set • ${minimumFbars * LOCK_MOUNTABLE_BYPASS_MULTIPLIER} FBARS bypass`;
}
