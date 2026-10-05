import type { LockMountableConfig, LockMountableCriterion, LockMountableRule } from "@/app/_types/lockMountable";

export const LOCK_MOUNTABLE_BYPASS_MULTIPLIER = 5;

export const DEFAULT_LOCK_MOUNTABLE_CONFIG: LockMountableConfig = {
  enabled: false,
  criterion: "fbars",
  rule: "block_below",
  minimumFbars: "",
};

export function normalizeLockMountableCriterion(value: unknown): LockMountableCriterion {
  return value === "fbars" ? value : "fbars";
}

export function normalizeLockMountableRule(value: unknown): LockMountableRule {
  return value === "block_at_or_above" ? value : "block_below";
}

export function normalizeLockMountableConfig(value: Partial<LockMountableConfig> | null | undefined): LockMountableConfig {
  return {
    enabled: Boolean(value?.enabled),
    criterion: normalizeLockMountableCriterion(value?.criterion),
    rule: normalizeLockMountableRule(value?.rule),
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

export function getLockMountableThresholdFbars(value: Partial<LockMountableConfig> | null | undefined) {
  return getLockMountableMinimumFbars(value);
}

export function getLockMountableBypassFbars(creatorFbars?: number | null) {
  if (typeof creatorFbars !== "number" || !Number.isFinite(creatorFbars) || creatorFbars < 0) {
    return null;
  }
  return Math.trunc(creatorFbars) * LOCK_MOUNTABLE_BYPASS_MULTIPLIER;
}

export function canAccessLockMountable(
  value: Partial<LockMountableConfig> | null | undefined,
  viewerFbars?: number | null,
  creatorFbars?: number | null,
) {
  const normalized = normalizeLockMountableConfig(value);
  if (!isLockMountableEnabled(value)) {
    return true;
  }

  const thresholdFbars = getLockMountableThresholdFbars(value);
  if (thresholdFbars === null) {
    return true;
  }

  if (typeof viewerFbars !== "number" || !Number.isFinite(viewerFbars) || viewerFbars < 0) {
    return false;
  }

  const participantFbars = Math.trunc(viewerFbars);
  const bypassFbars = getLockMountableBypassFbars(creatorFbars);
  if (bypassFbars !== null && participantFbars >= bypassFbars) {
    return true;
  }

  return normalized.rule === "block_at_or_above"
    ? participantFbars < thresholdFbars
    : participantFbars >= thresholdFbars;
}

export function lockMountableAccessMessage(
  value: Partial<LockMountableConfig> | null | undefined,
  creatorFbars?: number | null,
) {
  const normalized = normalizeLockMountableConfig(value);
  const threshold = getLockMountableThresholdFbars(normalized);
  if (threshold === null) return "This freight is locked.";
  const ruleMessage = normalized.rule === "block_at_or_above"
    ? `This freight is limited to participants below ${threshold} FBARS`
    : `This freight requires at least ${threshold} FBARS`;
  const bypassFbars = getLockMountableBypassFbars(creatorFbars);
  return bypassFbars === null ? ruleMessage : `${ruleMessage}, or ${bypassFbars} FBARS to override`;
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
  const ruleSummary = normalizeLockMountableRule(config.rule) === "block_at_or_above"
    ? `Block participants with ${minimumFbars} FBARS or more`
    : `Block participants with fewer than ${minimumFbars} FBARS`;
  return `${ruleSummary}; participants with 5x the creator's current FBARS can override`;
}
