import {
  computeGiftPreviewAllocations,
  parseGiftDirectiveSections,
  validateGiftConfiguration,
  type GiftApprovalRule,
  type GiftRatioEntry,
  type GiftSplitMode,
  type GiftTaggedUser,
} from "@/lib/giftDeliverables";

const SUMMARY_MAX_BYTES = 64;
const MAX_DURATION_SECONDS = 365n * 24n * 60n * 60n;
const MIN_TASK_DURATION_SECONDS = 1n * 60n;

export const MINUTES_PER_HOUR = 60;
export const TIMING_MINUTE_STEP = 1;
export const MIN_TASK_DURATION_MINUTES = 1;

const summaryEncoder = new TextEncoder();

function parseWholeNumberString(value: string, field: string) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${field} must be a whole number`);
  }

  return BigInt(trimmed);
}

function parseWholePercentString(value: string, field: string) {
  const parsed = parseWholeNumberString(value, field);
  if (parsed > 100n) {
    throw new Error(`${field} must be between 0 and 100`);
  }

  return parsed;
}

export function clampTimingMinutes(totalMinutes: number, minimumMinutes: number) {
  const clamped = Math.max(minimumMinutes, totalMinutes);
  return Math.round(clamped / TIMING_MINUTE_STEP) * TIMING_MINUTE_STEP;
}

export function formatTimingHours(totalMinutes: number) {
  const hours = totalMinutes / MINUTES_PER_HOUR;
  if (Number.isInteger(hours)) {
    return String(hours);
  }

  return hours.toFixed(10).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function parseStoredTimingHours(value: string, minimumMinutes = 0) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return minimumMinutes;
  }

  return clampTimingMinutes(Math.round(parsed * MINUTES_PER_HOUR), minimumMinutes);
}

export function splitTimingParts(value: string, minimumMinutes = 0) {
  const totalMinutes = parseStoredTimingHours(value, minimumMinutes);
  return {
    hours: Math.floor(totalMinutes / MINUTES_PER_HOUR),
    minutes: totalMinutes % MINUTES_PER_HOUR,
  };
}

export function buildTimingHoursFromParts(hoursPart: string, minutesPart: string, minimumMinutes = 0) {
  const hours = Number.parseInt(hoursPart, 10);
  const minutes = Number.parseInt(minutesPart, 10);
  const safeHours = Number.isFinite(hours) && hours >= 0 ? hours : 0;
  const safeMinutes = Number.isFinite(minutes) && minutes >= 0 ? Math.min(minutes, 59) : 0;
  const normalizedMinutes = clampTimingMinutes(safeHours * MINUTES_PER_HOUR + safeMinutes, minimumMinutes);
  return formatTimingHours(normalizedMinutes);
}

export type NormalizeCreateCampaignParamsInput = {
  maxAmountCkb: string;
  raffleSupportPoolPercent: string;
  raffleTicketPriceCkb: string;
  rewardCount: string;
  shouldCollectRaffleTicketPrice: boolean;
  summary: string;
  taskDurationHours: string;
  taskStartDelayHours: string;
};

export type NormalizedCreateCampaignParams = {
  auxAmountCkb: bigint;
  maximumAmountCkb: bigint;
  rewardCount: bigint;
  startDurationSecs: bigint;
  supportPoolBps: bigint;
  taskDurationSecs: bigint;
};

export type GiftCreateValidationInput = {
  approvalRule: GiftApprovalRule | null;
  claimants: GiftTaggedUser[];
  description: string;
  maxAmountCkb: string;
  openClaim: boolean;
  ratioEntries: GiftRatioEntry[];
  rewardCount: string;
  splitMode: GiftSplitMode | null;
};

export function validateGiftCreateConfiguration({
  approvalRule,
  claimants,
  description,
  maxAmountCkb,
  openClaim,
  ratioEntries,
  rewardCount,
  splitMode,
}: GiftCreateValidationInput) {
  const parsedDirectives = parseGiftDirectiveSections(description);
  const giftError = validateGiftConfiguration({
    approvalRule,
    approvers: parsedDirectives.approvers.map((handle) => ({ handle })),
    claimants,
    openClaim,
    ratioEntries,
    splitMode,
  });
  if (giftError) {
    return {
      error: giftError,
      preview: null,
    };
  }

  const preview = computeGiftPreviewAllocations({
    claimants,
    maxAmountCkb,
    rewardCount,
    ratioEntries,
    splitMode,
  });
  if (preview.error) {
    return {
      error: preview.error,
      preview,
    };
  }

  return {
    error: null,
    preview,
  };
}

export function normalizeCreateCampaignParams({
  maxAmountCkb,
  raffleSupportPoolPercent,
  raffleTicketPriceCkb,
  rewardCount,
  shouldCollectRaffleTicketPrice,
  summary,
  taskDurationHours,
  taskStartDelayHours,
}: NormalizeCreateCampaignParamsInput): NormalizedCreateCampaignParams {
  const trimmedSummary = summary.trim();
  if (trimmedSummary.length === 0) {
    throw new Error("Summary must be non-empty and fit within 64 UTF-8 bytes");
  }

  if (summaryEncoder.encode(trimmedSummary).length > SUMMARY_MAX_BYTES) {
    throw new Error("Summary must be non-empty and fit within 64 UTF-8 bytes");
  }

  const startDurationMinutes = parseStoredTimingHours(taskStartDelayHours, 0);
  const taskDurationMinutes = parseStoredTimingHours(taskDurationHours, 0);
  const startDurationSecs = BigInt(startDurationMinutes * 60);
  const taskDurationSecs = BigInt(taskDurationMinutes * 60);

  if (startDurationSecs > MAX_DURATION_SECONDS) {
    throw new Error("Start delay cannot exceed 365 days");
  }

  if (taskDurationSecs < MIN_TASK_DURATION_SECONDS) {
    throw new Error("Duration must be at least 1 minute");
  }

  if (taskDurationSecs > MAX_DURATION_SECONDS) {
    throw new Error("Duration cannot exceed 365 days");
  }

  const parsedRewardCount = parseWholeNumberString(rewardCount, "Split count");
  if (parsedRewardCount <= 0n) {
    throw new Error("Please enter a valid split count greater than 0");
  }

  if (shouldCollectRaffleTicketPrice) {
    const ticketCount = parseWholeNumberString(maxAmountCkb, "Number of tickets");
    const ticketPrice = parseWholeNumberString(raffleTicketPriceCkb, "Raffle ticket price");
    const supportPoolPercent = parseWholePercentString(raffleSupportPoolPercent, "Raffle support pool percentage");

    if (ticketCount <= 0n) {
      throw new Error("Please enter a valid number of tickets greater than 0");
    }

    if (ticketPrice <= 0n) {
      throw new Error("Please enter a valid raffle ticket price greater than 0 CKB");
    }

    const maximumAmount = ticketCount * ticketPrice;
    if (maximumAmount % ticketPrice !== 0n) {
      throw new Error("Raffle total must be divisible by ticket price");
    }

    return {
      auxAmountCkb: ticketPrice,
      maximumAmountCkb: maximumAmount,
      rewardCount: parsedRewardCount,
      startDurationSecs,
      supportPoolBps: supportPoolPercent * 100n,
      taskDurationSecs,
    };
  }

  const maximumAmount = parseWholeNumberString(maxAmountCkb, "Max deposit");
  if (maximumAmount <= 0n) {
    throw new Error("Please enter a valid max deposit greater than 0 CKB");
  }

  return {
    auxAmountCkb: 0n,
    maximumAmountCkb: maximumAmount,
    rewardCount: parsedRewardCount,
    startDurationSecs,
    supportPoolBps: 0n,
    taskDurationSecs,
  };
}
