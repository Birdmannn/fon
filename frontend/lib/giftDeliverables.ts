import { CampaignType } from "@/lib/contract";

export type GiftApprovalMode = "all" | "threshold";
export type GiftSplitMode = "equal" | "ratio";
export type GiftRole = "approve" | "claim" | "receive";
export type GiftCommencementState = "commenced" | "pending_approval";

export type GiftTaggedUser = {
  handle: string;
  address?: string | null;
};

export type GiftRatioEntry = {
  handle: string;
  address: string | null;
  units: number;
};

export type GiftApprovalRule = {
  mode: GiftApprovalMode;
  threshold?: number | null;
};

export type GiftApprovalRecord = {
  address: string;
  handle: string | null;
  approvedAt: string;
};

export type GiftDeliverable = {
  enabled: boolean;
  approvalRule: GiftApprovalRule | null;
  approvers: GiftTaggedUser[];
  claimants: GiftTaggedUser[];
  receivers: GiftTaggedUser[];
  splitMode: GiftSplitMode | null;
  ratioEntries: GiftRatioEntry[];
  commencementState: GiftCommencementState;
  requiredApprovalCount: number | null;
  approvals: GiftApprovalRecord[];
  commencedAt?: string | null;
};

export type GiftDirectiveParseResult = {
  enabled: boolean;
  approvers: string[];
  claimants: string[];
  receivers: string[];
  plainMentions: string[];
  hasApproveSection: boolean;
  hasClaimSection: boolean;
  hasReceiveSection: boolean;
};

export type GiftPreviewAllocation = {
  handle: string;
  amountLabel: string;
  amountShannons: string;
  units: number | null;
};

export type GiftPreviewSummary = {
  allocations: GiftPreviewAllocation[];
  claimSlotCount: number;
  error: string | null;
  openClaim: boolean;
  perClaimAmountLabel: string | null;
  perClaimAmountShannons: string | null;
  splitMode: GiftSplitMode | null;
  totalUnits: number | null;
};

const SHANNONS_PER_CKB = 100_000_000n;
const GIFT_DIRECTIVE_TOKENS = new Map<string, GiftRole>([
  ["approve", "approve"],
  ["claim", "claim"],
  ["receive", "receive"],
]);
const GIFT_MENTION_PATTERN = /@([a-zA-Z0-9_.]+)/g;

function formatCkbAmount(value: bigint) {
  return (Number(value) / 1e8).toFixed(2);
}

function formatUsernameHandle(username: string) {
  const normalized = username.trim().replace(/\.ckb$/i, "");
  return normalized ? `${normalized}.ckb` : "";
}

function normalizeUsername(value: string) {
  return value.trim().replace(/\.ckb$/i, "").toLowerCase();
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];

  values.forEach((value) => {
    if (!value || seen.has(value)) {
      return;
    }

    seen.add(value);
    output.push(value);
  });

  return output;
}

function parseWholeNumber(value: string) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  return BigInt(trimmed);
}

function parsePositiveInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeApprovalMode(value: unknown): GiftApprovalMode | null {
  if (value === "all" || value === "threshold") {
    return value;
  }

  return null;
}

function normalizeSplitMode(value: unknown): GiftSplitMode | null {
  if (value === "equal" || value === "ratio") {
    return value;
  }

  return null;
}

function parseDateInput(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    const normalizedValue = trimmed.length <= 10 ? parsed * 1000 : parsed;
    const nextDate = new Date(normalizedValue);
    return Number.isNaN(nextDate.getTime()) ? null : nextDate;
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const nextDate = new Date(parsed);
  return Number.isNaN(nextDate.getTime()) ? null : nextDate;
}

export function createEmptyGiftDeliverable(): GiftDeliverable {
  return {
    enabled: false,
    approvalRule: null,
    approvers: [],
    claimants: [],
    receivers: [],
    splitMode: null,
    ratioEntries: [],
    commencementState: "commenced",
    requiredApprovalCount: null,
    approvals: [],
    commencedAt: null,
  };
}

export function isGiftEligibleCampaignType(campaignType: number) {
  return campaignType === CampaignType.SimpleTask || campaignType === CampaignType.TimedChallenge;
}

export function normalizeGiftHandle(value: string) {
  return normalizeUsername(value.replace(/^@/, ""));
}

export function formatGiftHandle(value: string) {
  const normalized = normalizeGiftHandle(value);
  return normalized ? formatUsernameHandle(normalized) : "";
}

export function formatGiftMention(value: string) {
  const normalized = normalizeGiftHandle(value);
  return normalized ? `@${normalized}` : "";
}

export function formatGiftHandleFromMention(value: string) {
  const normalized = normalizeGiftHandle(value);
  return normalized ? formatGiftHandle(normalized) : "";
}

export function parseGiftDirectiveSections(description: string): GiftDirectiveParseResult {
  const approvers: string[] = [];
  const claimants: string[] = [];
  const receivers: string[] = [];
  const plainMentions: string[] = [];
  let activeRole: GiftRole | null = null;
  let hasApproveSection = false;
  let hasClaimSection = false;
  let hasReceiveSection = false;

  for (const match of description.matchAll(GIFT_MENTION_PATTERN)) {
    const token = normalizeGiftHandle(match[1] ?? "");
    if (!token) {
      continue;
    }

    const directiveRole = GIFT_DIRECTIVE_TOKENS.get(token) ?? null;
    if (directiveRole) {
      activeRole = directiveRole;
      if (directiveRole === "approve") {
        hasApproveSection = true;
      } else if (directiveRole === "claim") {
        hasClaimSection = true;
      } else if (directiveRole === "receive") {
        hasReceiveSection = true;
      }
      continue;
    }

    if (activeRole === "approve") {
      approvers.push(token);
      continue;
    }

    if (activeRole === "claim") {
      claimants.push(token);
      continue;
    }

    if (activeRole === "receive") {
      receivers.push(token);
      continue;
    }

    plainMentions.push(token);
  }

  return {
    enabled: hasApproveSection || hasClaimSection || hasReceiveSection,
    approvers: uniqueStrings(approvers),
    claimants: uniqueStrings(claimants),
    receivers: uniqueStrings(receivers),
    plainMentions: uniqueStrings(plainMentions),
    hasApproveSection,
    hasClaimSection,
    hasReceiveSection,
  };
}

export function buildGiftMentionList(parsed: GiftDirectiveParseResult) {
  return uniqueStrings([
    ...parsed.plainMentions,
    ...parsed.approvers,
    ...parsed.claimants,
    ...parsed.receivers,
  ]);
}

export function deriveRequiredApprovalCount(approverCount: number, approvalRule: GiftApprovalRule | null) {
  if (approverCount <= 0) {
    return null;
  }

  if (!approvalRule || approvalRule.mode === "all") {
    return approverCount;
  }

  const threshold = parsePositiveInteger(approvalRule.threshold);
  if (threshold === null) {
    return approverCount;
  }

  if (approverCount === 1) {
    return 1;
  }

  return Math.min(Math.max(1, threshold), approverCount - 1);
}

export function isGiftApprovalSatisfied(giftDeliverable: GiftDeliverable | null | undefined) {
  if (!giftDeliverable?.enabled) {
    return true;
  }

  if (giftDeliverable.approvers.length === 0) {
    return true;
  }

  const required = deriveRequiredApprovalCount(giftDeliverable.approvers.length, giftDeliverable.approvalRule);
  if (!required) {
    return true;
  }

  return giftDeliverable.approvals.length >= required;
}

export function hasGiftStartTimeReached(args: {
  chainCreatedAt?: string | null;
  taskStartDelayHours?: string | null;
  nowMs?: number;
}) {
  const createdAt = parseDateInput(args.chainCreatedAt ?? null);
  if (!createdAt) {
    return false;
  }

  const startDelayHours = Number.parseFloat(args.taskStartDelayHours?.trim() ?? "0");
  const startDelayMs = Number.isFinite(startDelayHours) && startDelayHours > 0 ? startDelayHours * 60 * 60 * 1000 : 0;
  return (args.nowMs ?? Date.now()) >= createdAt.getTime() + startDelayMs;
}

export function isGiftClaimOpen(args: {
  chainCreatedAt?: string | null;
  taskStartDelayHours?: string | null;
  giftDeliverable?: GiftDeliverable | null;
  nowMs?: number;
}) {
  if (!args.giftDeliverable?.enabled) {
    return false;
  }

  return hasGiftStartTimeReached({
    chainCreatedAt: args.chainCreatedAt,
    taskStartDelayHours: args.taskStartDelayHours,
    nowMs: args.nowMs,
  }) && isGiftApprovalSatisfied(args.giftDeliverable);
}

export function normalizeGiftTaggedUsers(
  handles: string[],
  resolvedAddressesByHandle: Record<string, string | null> = {},
): GiftTaggedUser[] {
  return uniqueStrings(handles.map((value) => normalizeGiftHandle(value)).filter(Boolean)).map((handle) => ({
    handle: formatGiftHandle(handle),
    address: resolvedAddressesByHandle[handle] ?? null,
  }));
}

export function normalizeGiftRatioEntries(
  entries: Array<{ handle: string; address?: string | null; units: number | string }>,
  resolvedAddressesByHandle: Record<string, string | null> = {},
): GiftRatioEntry[] {
  const output: GiftRatioEntry[] = [];

  entries.forEach((entry) => {
    const normalizedHandle = normalizeGiftHandle(entry.handle);
    const units = parsePositiveInteger(entry.units);
    if (!normalizedHandle || units === null) {
      return;
    }

    output.push({
      handle: formatGiftHandle(normalizedHandle),
      address: entry.address ?? resolvedAddressesByHandle[normalizedHandle] ?? null,
      units,
    });
  });

  return output;
}

export function buildGiftDeliverable(args: {
  campaignType: number;
  description: string;
  approvalRule: GiftApprovalRule | null;
  resolvedAddressesByHandle?: Record<string, string | null>;
  ratioEntries?: Array<{ handle: string; address?: string | null; units: number | string }>;
  splitMode: GiftSplitMode | null;
}) {
  const parsed = parseGiftDirectiveSections(args.description);
  if (!parsed.enabled || !isGiftEligibleCampaignType(args.campaignType)) {
    return createEmptyGiftDeliverable();
  }

  const approvers = normalizeGiftTaggedUsers(parsed.approvers, args.resolvedAddressesByHandle);
  const claimants = normalizeGiftTaggedUsers(parsed.claimants, args.resolvedAddressesByHandle);
  const receivers = normalizeGiftTaggedUsers(parsed.receivers, args.resolvedAddressesByHandle);
  const normalizedSplitMode = normalizeSplitMode(args.splitMode);
  const ratioEntries = normalizedSplitMode === "ratio"
    ? normalizeGiftRatioEntries(args.ratioEntries ?? [], args.resolvedAddressesByHandle)
    : [];
  const approvalRule = approvers.length > 0
    ? {
        mode: normalizeApprovalMode(args.approvalRule?.mode) ?? "all",
        threshold: args.approvalRule?.threshold ?? null,
      }
    : null;

  return {
    enabled: true,
    approvalRule,
    approvers,
    claimants,
    receivers,
    splitMode: normalizedSplitMode,
    ratioEntries,
    commencementState: approvers.length > 0 ? "pending_approval" : "commenced",
    requiredApprovalCount: deriveRequiredApprovalCount(approvers.length, approvalRule),
    approvals: [],
    commencedAt: approvers.length > 0 ? null : undefined,
  } satisfies GiftDeliverable;
}

export function computeGiftPreviewAllocations(args: {
  claimants: GiftTaggedUser[];
  maxAmountCkb: string;
  rewardCount: string;
  ratioEntries: GiftRatioEntry[];
  splitMode: GiftSplitMode | null;
}) {
  const maximumAmountCkb = parseWholeNumber(args.maxAmountCkb);
  if (maximumAmountCkb === null || maximumAmountCkb <= 0n) {
    return {
      allocations: [],
      claimSlotCount: 0,
      error: "Enter a valid max deposit greater than 0 CKB",
      openClaim: args.claimants.length === 0,
      perClaimAmountLabel: null,
      perClaimAmountShannons: null,
      splitMode: args.splitMode,
      totalUnits: null,
    } satisfies GiftPreviewSummary;
  }

  const totalShannons = maximumAmountCkb * SHANNONS_PER_CKB;
  if (args.claimants.length === 0) {
    const slotCount = parsePositiveInteger(args.rewardCount);
    if (slotCount === null) {
      return {
        allocations: [],
        claimSlotCount: 0,
        error: "Split count must be a whole number greater than 0 for open claims",
        openClaim: true,
        perClaimAmountLabel: null,
        perClaimAmountShannons: null,
        splitMode: "equal",
        totalUnits: null,
      } satisfies GiftPreviewSummary;
    }

    const perClaimAmount = slotCount > 0 ? totalShannons / BigInt(slotCount) : 0n;
    return {
      allocations: [],
      claimSlotCount: slotCount,
      error: null,
      openClaim: true,
      perClaimAmountLabel: `${formatCkbAmount(perClaimAmount)} CKB`,
      perClaimAmountShannons: perClaimAmount.toString(),
      splitMode: "equal",
      totalUnits: null,
    } satisfies GiftPreviewSummary;
  }

  if (args.splitMode === "ratio") {
    const ratioByHandle = new Map(
      args.ratioEntries.map((entry) => [normalizeGiftHandle(entry.handle), entry]),
    );
    const orderedRatios = args.claimants.map((claimant) => ratioByHandle.get(normalizeGiftHandle(claimant.handle)) ?? null);
    if (orderedRatios.some((entry) => entry === null)) {
      return {
        allocations: [],
        claimSlotCount: args.claimants.length,
        error: "Add ratio units for each tagged claimant",
        openClaim: false,
        perClaimAmountLabel: null,
        perClaimAmountShannons: null,
        splitMode: "ratio",
        totalUnits: null,
      } satisfies GiftPreviewSummary;
    }

    const totalUnits = orderedRatios.reduce((sum, entry) => sum + (entry?.units ?? 0), 0);
    if (totalUnits <= 0) {
      return {
        allocations: [],
        claimSlotCount: args.claimants.length,
        error: "Ratioed split requires a positive total unit count",
        openClaim: false,
        perClaimAmountLabel: null,
        perClaimAmountShannons: null,
        splitMode: "ratio",
        totalUnits,
      } satisfies GiftPreviewSummary;
    }

    let remaining = totalShannons;
    const allocations = args.claimants.map((claimant, index) => {
      const ratioEntry = orderedRatios[index]!;
      const amountShannons = index === args.claimants.length - 1
        ? remaining
        : (totalShannons * BigInt(ratioEntry.units)) / BigInt(totalUnits);
      remaining -= amountShannons;

      return {
        handle: claimant.handle,
        amountLabel: `${formatCkbAmount(amountShannons)} CKB`,
        amountShannons: amountShannons.toString(),
        units: ratioEntry.units,
      } satisfies GiftPreviewAllocation;
    });

    return {
      allocations,
      claimSlotCount: args.claimants.length,
      error: null,
      openClaim: false,
      perClaimAmountLabel: null,
      perClaimAmountShannons: null,
      splitMode: "ratio",
      totalUnits,
    } satisfies GiftPreviewSummary;
  }

  const claimSlotCount = args.claimants.length;
  let remaining = totalShannons;
  const baseAmount = claimSlotCount > 0 ? totalShannons / BigInt(claimSlotCount) : 0n;
  const allocations = args.claimants.map((claimant, index) => {
    const amountShannons = index === args.claimants.length - 1 ? remaining : baseAmount;
    remaining -= amountShannons;
    return {
      handle: claimant.handle,
      amountLabel: `${formatCkbAmount(amountShannons)} CKB`,
      amountShannons: amountShannons.toString(),
      units: null,
    } satisfies GiftPreviewAllocation;
  });

  return {
    allocations,
    claimSlotCount,
    error: null,
    openClaim: false,
    perClaimAmountLabel: null,
    perClaimAmountShannons: null,
    splitMode: "equal",
    totalUnits: null,
  } satisfies GiftPreviewSummary;
}

export function validateGiftConfiguration(args: {
  approvalRule: GiftApprovalRule | null;
  approvers?: GiftTaggedUser[];
  claimants: GiftTaggedUser[];
  openClaim: boolean;
  ratioEntries: GiftRatioEntry[];
  splitMode: GiftSplitMode | null;
}) {
  if (args.openClaim && args.splitMode === "ratio") {
    return "Ratioed split requires tagged claimants";
  }

  if (args.claimants.length > 0 && !args.splitMode) {
    return "Choose equal or ratioed split for tagged claimants";
  }

  if (args.splitMode === "ratio" && args.claimants.length > 0) {
    const ratioByHandle = new Map(args.ratioEntries.map((entry) => [normalizeGiftHandle(entry.handle), entry.units]));
    const totalUnits = args.claimants.reduce((sum, claimant) => sum + (ratioByHandle.get(normalizeGiftHandle(claimant.handle)) ?? 0), 0);
    if (args.claimants.some((claimant) => !ratioByHandle.has(normalizeGiftHandle(claimant.handle)))) {
      return "Add ratio units for each tagged claimant";
    }
    if (totalUnits <= 0) {
      return "Ratioed split requires a positive total unit count";
    }
  }

  if (args.approvalRule?.mode === "threshold") {
    const threshold = parsePositiveInteger(args.approvalRule.threshold);
    if (threshold === null) {
      return "Approval threshold must be greater than 0";
    }

    const approverCount = args.approvers?.length ?? 0;
    if (approverCount > 1 && threshold >= approverCount) {
      return "Approval threshold must be less than the total approver count";
    }
  }

  return null;
}

export function parseStoredGiftDeliverable(value: unknown): GiftDeliverable {
  if (!isObjectRecord(value)) {
    return createEmptyGiftDeliverable();
  }

  const enabled = Boolean(value.enabled);
  if (!enabled) {
    return createEmptyGiftDeliverable();
  }

  const approvalRuleValue = isObjectRecord(value.approvalRule) ? value.approvalRule : null;
  const approvalRule = approvalRuleValue
    ? {
        mode: normalizeApprovalMode(approvalRuleValue.mode) ?? "all",
        threshold: parsePositiveInteger(approvalRuleValue.threshold) ?? null,
      }
    : null;

  const approvers = Array.isArray(value.approvers)
    ? normalizeGiftTaggedUsers(
        value.approvers
          .map((entry) => isObjectRecord(entry) ? (typeof entry.handle === "string" ? entry.handle : "") : "")
          .filter(Boolean),
        Object.fromEntries(
          value.approvers
            .map((entry) => {
              if (!isObjectRecord(entry) || typeof entry.handle !== "string") {
                return null;
              }

              return [normalizeGiftHandle(entry.handle), typeof entry.address === "string" ? entry.address.trim() || null : null] as const;
            })
            .filter((entry): entry is readonly [string, string | null] => entry !== null),
        ),
      )
    : [];
  const claimants = Array.isArray(value.claimants)
    ? normalizeGiftTaggedUsers(
        value.claimants
          .map((entry) => isObjectRecord(entry) ? (typeof entry.handle === "string" ? entry.handle : "") : "")
          .filter(Boolean),
        Object.fromEntries(
          value.claimants
            .map((entry) => {
              if (!isObjectRecord(entry) || typeof entry.handle !== "string") {
                return null;
              }

              return [normalizeGiftHandle(entry.handle), typeof entry.address === "string" ? entry.address.trim() || null : null] as const;
            })
            .filter((entry): entry is readonly [string, string | null] => entry !== null),
        ),
      )
    : [];
  const receivers = Array.isArray(value.receivers)
    ? normalizeGiftTaggedUsers(
        value.receivers
          .map((entry) => isObjectRecord(entry) ? (typeof entry.handle === "string" ? entry.handle : "") : "")
          .filter(Boolean),
        Object.fromEntries(
          value.receivers
            .map((entry) => {
              if (!isObjectRecord(entry) || typeof entry.handle !== "string") {
                return null;
              }

              return [normalizeGiftHandle(entry.handle), typeof entry.address === "string" ? entry.address.trim() || null : null] as const;
            })
            .filter((entry): entry is readonly [string, string | null] => entry !== null),
        ),
      )
    : [];
  const splitMode = normalizeSplitMode(value.splitMode);
  const ratioEntries = Array.isArray(value.ratioEntries)
    ? normalizeGiftRatioEntries(
        value.ratioEntries.map((entry) => ({
          handle: isObjectRecord(entry) && typeof entry.handle === "string" ? entry.handle : "",
          address: isObjectRecord(entry) && typeof entry.address === "string" ? entry.address : null,
          units: isObjectRecord(entry) && (typeof entry.units === "number" || typeof entry.units === "string") ? entry.units : 0,
        }))
      )
    : [];
  const requiredApprovalCount = approvers.length > 0
    ? (parsePositiveInteger(value.requiredApprovalCount) ?? deriveRequiredApprovalCount(approvers.length, approvalRule))
    : null;
  const approvals: GiftApprovalRecord[] = [];
  if (Array.isArray(value.approvals)) {
    value.approvals.forEach((entry) => {
      if (!isObjectRecord(entry) || typeof entry.address !== "string") {
        return;
      }

      approvals.push({
        address: entry.address.trim().toLowerCase(),
        handle: typeof entry.handle === "string" ? entry.handle.trim() || null : null,
        approvedAt: typeof entry.approvedAt === "string" && entry.approvedAt.trim().length > 0
          ? entry.approvedAt.trim()
          : new Date().toISOString(),
      });
    });
  }
  const commencementState = approvers.length > 0
    ? (value.commencementState === "commenced" ? "commenced" : "pending_approval")
    : "commenced";

  return {
    enabled,
    approvalRule,
    approvers,
    claimants,
    receivers,
    splitMode,
    ratioEntries,
    commencementState,
    requiredApprovalCount,
    approvals,
    commencedAt: typeof value.commencedAt === "string" ? value.commencedAt.trim() || null : null,
  } satisfies GiftDeliverable;
}

export function stripGiftDirectiveMarkers(text: string) {
  return text.replace(/(^|\s)@(approve|claim|receive)\b/gi, "$1");
}

export function matchesGiftHandle(storedHandle: string, candidateHandle: string | null | undefined) {
  if (!candidateHandle) {
    return false;
  }

  return normalizeGiftHandle(storedHandle) === normalizeGiftHandle(candidateHandle);
}
