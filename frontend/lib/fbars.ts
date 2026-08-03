import type { Collection, Document } from "mongodb";

import { CampaignType } from "@/lib/contract";

export const WEEKLY_INTERACTION_MILESTONE = 5;
export const WEEKLY_INTERACTION_MILESTONE_FBARS = 2;
export const WEEKLY_WIN_MILESTONE = 5;
export const WEEKLY_WIN_MILESTONE_FBARS = 10;
export const FREIGHT_CREATION_FBARS_COST = 20;
export const WALLET_BALANCE_FBARS_DIVISOR_CKB = 1000n;
export const DEPOSIT_FBARS_DIVISOR_CKB = 1000n;
export const DEPOSIT_FBARS_MULTIPLIER = 2;
export const WEEKLY_MARQUEE_MAX_EDITS = 2;

export type WeeklyFbarsState = {
  weekKey: string;
  total: number;
  winCount: number;
  interactionCount: number;
  creatorWinningInteractionCount: number;
  creatorNonWinningInteractionCount: number;
  marqueeEditCount: number;
};

export type StoredFbarsProfile = {
  address?: unknown;
  fbars?: unknown;
  weeklyFbarsState?: Partial<WeeklyFbarsState> | null;
  walletFbarsSeededAt?: unknown;
  walletFbarsSeedBalanceShannons?: unknown;
};

export type FbarEventKind =
  | "wallet-seed"
  | "freight-create"
  | "deposit"
  | "interaction"
  | "creator-winning-interaction"
  | "creator-non-winning-interaction"
  | "win"
  | "marquee-edit";

export type FbarEventRecord = {
  eventKey: string;
  address: string;
  weekKey: string;
  kind: FbarEventKind;
  delta: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type FbarAwardParams = {
  address: string;
  weekKey: string;
  eventKey: string;
  kind: FbarEventKind;
  delta: number;
  metadata?: Record<string, unknown>;
  currentProfile?: StoredFbarsProfile | null;
};

export type WeeklyLeaderboardEntry = {
  address: string;
  username: string;
  handle: string;
  displayName: string;
  fbars: number;
  weeklyFbars: number;
  adsfUsdCents: number;
  rank: number;
  updatedAt?: string | null;
  lastSeenAt?: string | null;
};

export function getUtcCalendarWeekStart(value = new Date()) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  const dayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayOffset);
  return date;
}

export function getCurrentWeekKey(value = new Date()) {
  return getUtcCalendarWeekStart(value).toISOString().slice(0, 10);
}

export function isWinningCampaignType(campaignType: number) {
  return campaignType === CampaignType.Raffle
    || campaignType === CampaignType.TimedChallenge
    || campaignType === CampaignType.FundedTask;
}

export function isNonWinningCampaignType(campaignType: number) {
  return campaignType === CampaignType.SimpleTask
    || campaignType === CampaignType.Crowdfunding;
}

export function parseInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return 0;
}

export function parseNonNegativeInteger(value: unknown) {
  return Math.max(0, parseInteger(value));
}

export function parseWeeklyFbarsState(profile: StoredFbarsProfile | null | undefined, weekKey: string): WeeklyFbarsState {
  const stored = profile?.weeklyFbarsState;
  if (!stored || typeof stored !== "object" || stored.weekKey !== weekKey) {
    return {
      weekKey,
      total: 0,
      winCount: 0,
      interactionCount: 0,
      creatorWinningInteractionCount: 0,
      creatorNonWinningInteractionCount: 0,
      marqueeEditCount: 0,
    };
  }

  return {
    weekKey,
    total: parseInteger(stored.total),
    winCount: parseNonNegativeInteger(stored.winCount),
    interactionCount: parseNonNegativeInteger(stored.interactionCount),
    creatorWinningInteractionCount: parseNonNegativeInteger(stored.creatorWinningInteractionCount),
    creatorNonWinningInteractionCount: parseNonNegativeInteger(stored.creatorNonWinningInteractionCount),
    marqueeEditCount: parseNonNegativeInteger(stored.marqueeEditCount),
  };
}

export function getWeeklyMarqueeEditsRemaining(profile: StoredFbarsProfile | null | undefined, weekKey: string) {
  const state = parseWeeklyFbarsState(profile, weekKey);
  return Math.max(0, WEEKLY_MARQUEE_MAX_EDITS - state.marqueeEditCount);
}

export function computeMilestoneBonus(previousCount: number, nextCount: number, step: number, bonus: number) {
  if (step <= 0 || bonus <= 0 || nextCount <= previousCount) {
    return 0;
  }

  const previousMilestones = Math.floor(previousCount / step);
  const nextMilestones = Math.floor(nextCount / step);
  return Math.max(0, nextMilestones - previousMilestones) * bonus;
}

export function computeWalletSeedFbars(balanceShannons: bigint) {
  return Number(balanceShannons / (WALLET_BALANCE_FBARS_DIVISOR_CKB * 100_000_000n));
}

export function computeDepositFbars(amountShannons: bigint) {
  return Number((amountShannons / (DEPOSIT_FBARS_DIVISOR_CKB * 100_000_000n)) * BigInt(DEPOSIT_FBARS_MULTIPLIER));
}

export function computeRewardFbars(amountShannons: bigint) {
  return Number(amountShannons / (1_000n * 100_000_000n));
}

export function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

export async function awardFbarsEvent(params: FbarAwardParams & {
  profilesCollection: Collection<Document>;
  eventsCollection: Collection<Document>;
}) {
  const normalizedAddress = normalizeAddress(params.address);
  const insertedEvent = {
    eventKey: params.eventKey,
    address: normalizedAddress,
    weekKey: params.weekKey,
    kind: params.kind,
    delta: params.delta,
    metadata: params.metadata ?? {},
    createdAt: new Date().toISOString(),
  } satisfies FbarEventRecord;

  const existingEvent = await params.eventsCollection.findOne(
    { eventKey: insertedEvent.eventKey },
    { projection: { _id: 1 } },
  );
  if (existingEvent) {
    return { applied: false, event: insertedEvent };
  }

  const currentProfile = params.currentProfile ?? await params.profilesCollection.findOne(
    { address: normalizedAddress },
    { projection: { _id: 0, address: 1, fbars: 1, weeklyFbarsState: 1 } },
  ) as StoredFbarsProfile | null;
  const weeklyState = parseWeeklyFbarsState(currentProfile, params.weekKey);

  const nextWeeklyState: WeeklyFbarsState = {
    ...weeklyState,
    total: params.kind === "wallet-seed" ? weeklyState.total : weeklyState.total + params.delta,
  };

  if (params.kind === "interaction") {
    const nextInteractionCount = weeklyState.interactionCount + 1;
    nextWeeklyState.interactionCount = nextInteractionCount;
    nextWeeklyState.total += computeMilestoneBonus(
      weeklyState.interactionCount,
      nextInteractionCount,
      WEEKLY_INTERACTION_MILESTONE,
      WEEKLY_INTERACTION_MILESTONE_FBARS,
    );
  }

  if (params.kind === "creator-winning-interaction") {
    const nextCount = weeklyState.creatorWinningInteractionCount + 1;
    nextWeeklyState.creatorWinningInteractionCount = nextCount;
    nextWeeklyState.total += computeMilestoneBonus(weeklyState.creatorWinningInteractionCount, nextCount, 5, 2);
  }

  if (params.kind === "creator-non-winning-interaction") {
    const nextCount = weeklyState.creatorNonWinningInteractionCount + 1;
    nextWeeklyState.creatorNonWinningInteractionCount = nextCount;
    nextWeeklyState.total += computeMilestoneBonus(weeklyState.creatorNonWinningInteractionCount, nextCount, 5, 1);
  }

  if (params.kind === "win") {
    const nextWinCount = weeklyState.winCount + 1;
    nextWeeklyState.winCount = nextWinCount;
    nextWeeklyState.total += computeMilestoneBonus(
      weeklyState.winCount,
      nextWinCount,
      WEEKLY_WIN_MILESTONE,
      WEEKLY_WIN_MILESTONE_FBARS,
    );
  }

  if (params.kind === "marquee-edit") {
    nextWeeklyState.marqueeEditCount = weeklyState.marqueeEditCount + 1;
  }

  const nextLifetimeFbars = Math.max(0, parseNonNegativeInteger(currentProfile?.fbars) + params.delta);

  await params.eventsCollection.insertOne(insertedEvent);
  await params.profilesCollection.updateOne(
    { address: normalizedAddress },
    {
      $set: {
        address: normalizedAddress,
        fbars: nextLifetimeFbars,
        weeklyFbarsState: nextWeeklyState,
        updatedAt: new Date(),
        lastSeenAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );

  return {
    applied: true,
    event: insertedEvent,
    weeklyFbarsState: nextWeeklyState,
    lifetimeFbars: nextLifetimeFbars,
  };
}
