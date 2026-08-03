import { NextResponse } from "next/server";

import { SignerSignType } from "@ckb-ccc/core";

import {
  getCurrentWeekKey,
  getWeeklyMarqueeEditsRemaining,
  parseInteger,
  parseNonNegativeInteger,
  parseWeeklyFbarsState,
  WEEKLY_MARQUEE_MAX_EDITS,
  type StoredFbarsProfile,
} from "@/lib/fbars";
import { verifyWalletSignature } from "@/lib/googleAuth";
import { getUserProfilesCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

const MAX_WEEKLY_MARQUEE_MESSAGE_LENGTH = 120;

const BASE_PROFILE_PROJECTION = {
  _id: 0,
  address: 1,
  username: 1,
  displayName: 1,
  fbars: 1,
  adsfUsdCents: 1,
  updatedAt: 1,
  lastSeenAt: 1,
  weeklyFbarsState: 1,
  walletFbarsSeededAt: 1,
  walletFbarsSeedBalanceShannons: 1,
  weeklyMarqueeMessage: 1,
  weeklyMarqueeWeekKey: 1,
  weeklyMarqueeUpdatedAt: 1,
} as const;

type WalletSignaturePayload = {
  signature?: unknown;
  identity?: unknown;
  signType?: unknown;
};

type UserProfilePayload = {
  address?: unknown;
  username?: unknown;
  displayName?: unknown;
  adsfUsdCents?: unknown;
  weeklyMarqueeMessage?: unknown;
  nonce?: unknown;
  signature?: WalletSignaturePayload | null;
  googleAccount?: {
    sub?: unknown;
    email?: unknown;
    emailVerified?: unknown;
    picture?: unknown;
    linkedAt?: unknown;
    lastRefreshedAt?: unknown;
  } | null;
  includePrivate?: unknown;
};

type LeaderboardEntry = {
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

type WeeklyMarqueeOwner = Pick<LeaderboardEntry, "address" | "username" | "handle" | "displayName">;

type GoogleAccountProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
  picture?: string | null;
  linkedAt?: string | null;
  lastRefreshedAt?: string | null;
};

type StoredProfileRecord = StoredFbarsProfile & {
  address?: unknown;
  username?: unknown;
  displayName?: unknown;
  adsfUsdCents?: unknown;
  updatedAt?: string | null;
  lastSeenAt?: string | null;
  googleAccount?: unknown;
  weeklyMarqueeMessage?: unknown;
  weeklyMarqueeWeekKey?: unknown;
  weeklyMarqueeUpdatedAt?: unknown;
};

type UserProfileResponse = LeaderboardEntry & {
  overallRank: number;
  weeklyRank: number;
  canEditWeeklyMarquee: boolean;
  weeklyMarqueeMessage?: string | null;
  weeklyMarqueeWeekKey?: string | null;
  weeklyMarqueeEditsUsed: number;
  weeklyMarqueeEditsRemaining: number;
  weeklyMarqueeMaxEdits: number;
  hasSeededWalletFbars: boolean;
  googleAccount?: GoogleAccountProfile | null;
};

type ActiveWeeklyMarqueeResponse = {
  activeWeeklyMarqueeMessage: string | null;
  activeWeeklyMarqueeOwner: WeeklyMarqueeOwner | null;
  activeWeeklyMarqueeWeekKey: string;
  activeWeeklyMarqueeEditsUsed: number;
  activeWeeklyMarqueeEditsRemaining: number;
  activeWeeklyMarqueeMaxEdits: number;
};

type LeaderboardBundle = {
  overallLeaderboard: LeaderboardEntry[];
  weeklyLeaderboard: LeaderboardEntry[];
  weekKey: string;
  weeklyWinnerAddress: string | null;
};

function buildDefaultUsername(addressHex: string) {
  const normalized = addressHex.toLowerCase().replace(/^0x/, "");
  return `freight${normalized.slice(-20)}`;
}

function buildDefaultDisplayName(userCount: number) {
  return `User${userCount + 1}`;
}

function formatUsernameHandle(username: string) {
  const normalized = username.trim().replace(/\.ckb$/i, "");
  return normalized ? `${normalized}.ckb` : "";
}

function normalizeUsername(value: string) {
  return value.trim().replace(/\.ckb$/i, "").toLowerCase();
}

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function ensureString(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }

  return value.trim();
}

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

function sanitizeDisplayName(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("display name is required");
  }

  if (normalized.length > 10) {
    throw new Error("display name must be 10 characters or fewer");
  }

  return normalized;
}

function sanitizeWeeklyMarqueeMessage(value: string) {
  const normalized = value.trim();
  if (normalized.length > MAX_WEEKLY_MARQUEE_MESSAGE_LENGTH) {
    throw new Error(`marquee message must be ${MAX_WEEKLY_MARQUEE_MESSAGE_LENGTH} characters or fewer`);
  }

  return normalized;
}

function parseFbars(value: unknown) {
  return parseNonNegativeInteger(value);
}

function parseAdsfUsdCents(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return 0;
}

function sanitizeGoogleAccount(value: unknown): GoogleAccountProfile | null {
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
    linkedAt: typeof candidate.linkedAt === "string" ? candidate.linkedAt : null,
    lastRefreshedAt: typeof candidate.lastRefreshedAt === "string" ? candidate.lastRefreshedAt : null,
  };
}

function attachGoogleAccountToProfile(profile: UserProfileResponse | null, googleAccount: GoogleAccountProfile | null): UserProfileResponse | null {
  if (!profile) {
    return null;
  }

  return {
    ...profile,
    googleAccount,
  };
}

function parseVerifiedSignature(signaturePayload: unknown) {
  if (!signaturePayload || typeof signaturePayload !== "object") {
    throw new Error("signature is required");
  }

  const signature = ensureString((signaturePayload as WalletSignaturePayload).signature, "signature.signature");
  const identity = ensureString((signaturePayload as WalletSignaturePayload).identity, "signature.identity");
  const signTypeValue = ensureString((signaturePayload as WalletSignaturePayload).signType, "signature.signType");
  if (!Object.values(SignerSignType).includes(signTypeValue as SignerSignType)) {
    throw new Error("Unsupported signer sign type");
  }

  return {
    signature,
    identity,
    signType: signTypeValue as SignerSignType,
  };
}

function buildLeaderboardEntry(profile: StoredProfileRecord, weekKey: string): LeaderboardEntry {
  const address = typeof profile.address === "string" ? normalizeAddress(profile.address) : "";
  const username = typeof profile.username === "string" && profile.username.trim().length > 0
    ? profile.username.trim()
    : buildDefaultUsername(address);
  const weeklyState = parseWeeklyFbarsState(profile, weekKey);

  return {
    address,
    username,
    handle: formatUsernameHandle(username),
    displayName: typeof profile.displayName === "string" && profile.displayName.trim().length > 0
      ? profile.displayName.trim()
      : username,
    fbars: parseFbars(profile.fbars),
    weeklyFbars: parseInteger(weeklyState.total),
    adsfUsdCents: parseAdsfUsdCents(profile.adsfUsdCents),
    rank: 0,
    updatedAt: profile.updatedAt ?? null,
    lastSeenAt: profile.lastSeenAt ?? null,
  };
}

function rankLeaderboard(entries: LeaderboardEntry[], metric: "overall" | "weekly") {
  return entries
    .slice()
    .sort((left, right) => {
      const leftValue = metric === "weekly" ? left.weeklyFbars : left.fbars;
      const rightValue = metric === "weekly" ? right.weeklyFbars : right.fbars;
      if (rightValue !== leftValue) {
        return rightValue - leftValue;
      }

      const handleCompare = left.handle.localeCompare(right.handle, undefined, { sensitivity: "base" });
      if (handleCompare !== 0) {
        return handleCompare;
      }

      return left.address.localeCompare(right.address, undefined, { sensitivity: "base" });
    })
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }));
}

function buildLeaderboardBundle(profiles: StoredProfileRecord[], now = new Date()): LeaderboardBundle {
  const weekKey = getCurrentWeekKey(now);
  const baseEntries = profiles.map((profile) => buildLeaderboardEntry(profile, weekKey));
  const overallLeaderboard = rankLeaderboard(baseEntries, "overall");
  const weeklyLeaderboard = rankLeaderboard(baseEntries, "weekly");

  return {
    overallLeaderboard,
    weeklyLeaderboard,
    weekKey,
    weeklyWinnerAddress: (weeklyLeaderboard[0]?.weeklyFbars ?? 0) > 0 ? (weeklyLeaderboard[0]?.address ?? null) : null,
  };
}

function buildProfilesByAddress(profiles: StoredProfileRecord[]) {
  return new Map(
    profiles.map((profile) => [typeof profile.address === "string" ? normalizeAddress(profile.address) : "", profile]),
  );
}

function buildFallbackUserProfileResponse(address: string, bundle: LeaderboardBundle, now: Date): UserProfileResponse {
  const username = buildDefaultUsername(address);
  return {
    address,
    username,
    handle: formatUsernameHandle(username),
    displayName: buildDefaultDisplayName(bundle.overallLeaderboard.length),
    fbars: 0,
    weeklyFbars: 0,
    adsfUsdCents: 0,
    rank: bundle.weeklyLeaderboard.length + 1,
    weeklyRank: bundle.weeklyLeaderboard.length + 1,
    overallRank: bundle.overallLeaderboard.length + 1,
    canEditWeeklyMarquee: false,
    weeklyMarqueeMessage: null,
    weeklyMarqueeWeekKey: null,
    weeklyMarqueeEditsUsed: 0,
    weeklyMarqueeEditsRemaining: WEEKLY_MARQUEE_MAX_EDITS,
    weeklyMarqueeMaxEdits: WEEKLY_MARQUEE_MAX_EDITS,
    hasSeededWalletFbars: false,
    updatedAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
  };
}

function buildUserProfileResponse(
  address: string,
  bundle: LeaderboardBundle,
  rawProfile: StoredProfileRecord | null,
): UserProfileResponse | null {
  const overallEntry = bundle.overallLeaderboard.find((entry) => entry.address === address) ?? null;
  const weeklyEntry = bundle.weeklyLeaderboard.find((entry) => entry.address === address) ?? null;
  const baseEntry = weeklyEntry ?? overallEntry;

  if (!baseEntry) {
    return null;
  }

  const weeklyMarqueeMessage = typeof rawProfile?.weeklyMarqueeMessage === "string" && rawProfile.weeklyMarqueeMessage.trim().length > 0
    ? rawProfile.weeklyMarqueeMessage.trim()
    : null;
  const weeklyMarqueeWeekKey = typeof rawProfile?.weeklyMarqueeWeekKey === "string"
    ? rawProfile.weeklyMarqueeWeekKey
    : null;
  const weeklyState = parseWeeklyFbarsState(rawProfile, bundle.weekKey);
  const weeklyMarqueeEditsRemaining = getWeeklyMarqueeEditsRemaining(rawProfile, bundle.weekKey);

  return {
    ...baseEntry,
    weeklyRank: weeklyEntry?.rank ?? 0,
    overallRank: overallEntry?.rank ?? 0,
    canEditWeeklyMarquee: bundle.weeklyWinnerAddress === baseEntry.address && weeklyMarqueeEditsRemaining > 0,
    weeklyMarqueeMessage,
    weeklyMarqueeWeekKey,
    weeklyMarqueeEditsUsed: weeklyState.marqueeEditCount,
    weeklyMarqueeEditsRemaining,
    weeklyMarqueeMaxEdits: WEEKLY_MARQUEE_MAX_EDITS,
    hasSeededWalletFbars: typeof rawProfile?.walletFbarsSeededAt === "string" && rawProfile.walletFbarsSeededAt.trim().length > 0,
  };
}

function buildActiveWeeklyMarquee(
  bundle: LeaderboardBundle,
  profilesByAddress: Map<string, StoredProfileRecord>,
): ActiveWeeklyMarqueeResponse {
  if (!bundle.weeklyWinnerAddress) {
    return {
      activeWeeklyMarqueeMessage: null,
      activeWeeklyMarqueeOwner: null,
      activeWeeklyMarqueeWeekKey: bundle.weekKey,
      activeWeeklyMarqueeEditsUsed: 0,
      activeWeeklyMarqueeEditsRemaining: WEEKLY_MARQUEE_MAX_EDITS,
      activeWeeklyMarqueeMaxEdits: WEEKLY_MARQUEE_MAX_EDITS,
    };
  }

  const winner = bundle.weeklyLeaderboard[0] ?? null;
  const winnerProfile = profilesByAddress.get(bundle.weeklyWinnerAddress);
  const weeklyMarqueeMessage = typeof winnerProfile?.weeklyMarqueeMessage === "string"
    ? winnerProfile.weeklyMarqueeMessage.trim()
    : "";
  const weeklyMarqueeWeekKey = typeof winnerProfile?.weeklyMarqueeWeekKey === "string"
    ? winnerProfile.weeklyMarqueeWeekKey
    : null;
  const weeklyState = parseWeeklyFbarsState(winnerProfile, bundle.weekKey);

  if (!winner || !weeklyMarqueeMessage || weeklyMarqueeWeekKey !== bundle.weekKey) {
    return {
      activeWeeklyMarqueeMessage: null,
      activeWeeklyMarqueeOwner: null,
      activeWeeklyMarqueeWeekKey: bundle.weekKey,
      activeWeeklyMarqueeEditsUsed: weeklyState.marqueeEditCount,
      activeWeeklyMarqueeEditsRemaining: getWeeklyMarqueeEditsRemaining(winnerProfile, bundle.weekKey),
      activeWeeklyMarqueeMaxEdits: WEEKLY_MARQUEE_MAX_EDITS,
    };
  }

  return {
    activeWeeklyMarqueeMessage: weeklyMarqueeMessage,
    activeWeeklyMarqueeOwner: {
      address: winner.address,
      username: winner.username,
      handle: winner.handle,
      displayName: winner.displayName,
    },
    activeWeeklyMarqueeWeekKey: bundle.weekKey,
    activeWeeklyMarqueeEditsUsed: weeklyState.marqueeEditCount,
    activeWeeklyMarqueeEditsRemaining: getWeeklyMarqueeEditsRemaining(winnerProfile, bundle.weekKey),
    activeWeeklyMarqueeMaxEdits: WEEKLY_MARQUEE_MAX_EDITS,
  };
}

async function loadAllProfiles(includePrivate = false) {
  const collection = await getUserProfilesCollection();
  return (await collection.find({}, {
    projection: {
      ...BASE_PROFILE_PROJECTION,
      ...(includePrivate ? { googleAccount: 1 } : {}),
    },
  }).toArray()) as StoredProfileRecord[];
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const addressesParam = url.searchParams.get("addresses")?.trim();
    const addressParam = url.searchParams.get("address")?.trim();
    const handleParam = url.searchParams.get("handle")?.trim();
    const includePrivate = url.searchParams.get("includePrivate") === "1";
    const marqueeOnly = url.searchParams.get("marquee") === "1";
    const collection = await getUserProfilesCollection();

    if (marqueeOnly) {
      const profiles = await loadAllProfiles();
      const bundle = buildLeaderboardBundle(profiles);
      const profilesByAddress = buildProfilesByAddress(profiles);
      return NextResponse.json(buildActiveWeeklyMarquee(bundle, profilesByAddress));
    }

    const projection = {
      ...BASE_PROFILE_PROJECTION,
      ...(includePrivate ? { googleAccount: 1 } : {}),
    };

    if (handleParam) {
      const profiles = (await collection.find({}, { projection }).toArray()) as StoredProfileRecord[];
      const bundle = buildLeaderboardBundle(profiles);
      const profilesByAddress = buildProfilesByAddress(profiles);
      const activeWeeklyMarquee = buildActiveWeeklyMarquee(bundle, profilesByAddress);
      const normalizedHandle = normalizeUsername(handleParam);
      const rawProfile = profiles.find((entry) => {
        const username = typeof entry.username === "string" ? entry.username : "";
        const handle = formatUsernameHandle(username);
        return normalizeUsername(username) === normalizedHandle || normalizeUsername(handle) === normalizedHandle;
      }) ?? null;

      if (!rawProfile || typeof rawProfile.address !== "string") {
        return badRequest("User profile not found", 404);
      }

      const profile = buildUserProfileResponse(normalizeAddress(rawProfile.address), bundle, rawProfile);
      if (!profile) {
        return badRequest("User profile not found", 404);
      }

      return NextResponse.json({
        profile: includePrivate ? attachGoogleAccountToProfile(profile, sanitizeGoogleAccount(rawProfile.googleAccount)) : profile,
        leaderboard: bundle.weeklyLeaderboard,
        weeklyLeaderboard: bundle.weeklyLeaderboard,
        overallLeaderboard: bundle.overallLeaderboard,
        ...activeWeeklyMarquee,
      });
    }

    const requestedAddresses = [
      ...(addressesParam ? addressesParam.split(",") : []),
      ...(addressParam ? [addressParam] : []),
    ]
      .map(normalizeAddress)
      .filter(Boolean);

    if (requestedAddresses.length === 0) {
      return badRequest("address, addresses, handle, or marquee is required");
    }

    const uniqueAddresses = Array.from(new Set(requestedAddresses));
    const profiles = (await collection.find({ address: { $in: uniqueAddresses } }, { projection }).toArray()) as StoredProfileRecord[];
    const bundle = buildLeaderboardBundle(profiles);
    const leaderboard = bundle.overallLeaderboard.filter((entry) => uniqueAddresses.includes(entry.address));

    if (!includePrivate) {
      return NextResponse.json({
        profiles: leaderboard,
      });
    }

    const profilesByAddress = buildProfilesByAddress(profiles);

    return NextResponse.json({
      profiles: leaderboard.map((entry) => attachGoogleAccountToProfile(
        {
          ...entry,
          weeklyRank: bundle.weeklyLeaderboard.find((weeklyEntry) => weeklyEntry.address === entry.address)?.rank ?? 0,
          overallRank: entry.rank,
          canEditWeeklyMarquee: false,
          weeklyMarqueeMessage: null,
          weeklyMarqueeWeekKey: null,
          weeklyMarqueeEditsUsed: parseWeeklyFbarsState(profilesByAddress.get(entry.address), bundle.weekKey).marqueeEditCount,
          weeklyMarqueeEditsRemaining: getWeeklyMarqueeEditsRemaining(profilesByAddress.get(entry.address), bundle.weekKey),
          weeklyMarqueeMaxEdits: WEEKLY_MARQUEE_MAX_EDITS,
          hasSeededWalletFbars: typeof profilesByAddress.get(entry.address)?.walletFbarsSeededAt === "string",
        },
        sanitizeGoogleAccount(profilesByAddress.get(entry.address)?.googleAccount),
      )).filter(Boolean),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch user profiles";
    return badRequest(message, 500);
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as UserProfilePayload;
    const address = normalizeAddress(ensureString(payload.address, "address"));
    const collection = await getUserProfilesCollection();
    const now = new Date();

    const existingUserCount = await collection.countDocuments();

    await collection.updateOne(
      { address },
      {
        $set: {
          address,
          updatedAt: now,
          lastSeenAt: now,
        },
        $setOnInsert: {
          username: buildDefaultUsername(address),
          displayName: buildDefaultDisplayName(existingUserCount),
          fbars: 0,
          adsfUsdCents: 0,
          createdAt: now,
        },
      },
      { upsert: true }
    );

    const profiles = await loadAllProfiles();
    const bundle = buildLeaderboardBundle(profiles, now);
    const profilesByAddress = buildProfilesByAddress(profiles);
    const profile = buildUserProfileResponse(address, bundle, profilesByAddress.get(address) ?? null)
      ?? buildFallbackUserProfileResponse(address, bundle, now);
    const privateProfile = await collection.findOne(
      { address },
      { projection: { _id: 0, googleAccount: 1 } },
    );

    return NextResponse.json({
      profile: attachGoogleAccountToProfile(profile, sanitizeGoogleAccount(privateProfile?.googleAccount)),
      leaderboard: bundle.weeklyLeaderboard,
      weeklyLeaderboard: bundle.weeklyLeaderboard,
      overallLeaderboard: bundle.overallLeaderboard,
      ...buildActiveWeeklyMarquee(bundle, profilesByAddress),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to ensure user profile";
    return badRequest(message);
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as UserProfilePayload;
    const address = normalizeAddress(ensureString(payload.address, "address"));
    const collection = await getUserProfilesCollection();
    const now = new Date();
    const googleAccount = sanitizeGoogleAccount(payload.googleAccount);

    const nextSet: Record<string, unknown> = {
      address,
      updatedAt: now,
      lastSeenAt: now,
    };

    if (typeof payload.displayName === "string") {
      nextSet.displayName = sanitizeDisplayName(ensureString(payload.displayName, "displayName"));
    }

    if (typeof payload.adsfUsdCents === "number" && Number.isInteger(payload.adsfUsdCents) && payload.adsfUsdCents >= 0) {
      nextSet.adsfUsdCents = payload.adsfUsdCents;
    }

    if (payload.weeklyMarqueeMessage !== undefined) {
      const nonce = ensureString(payload.nonce, "nonce");
      const signature = parseVerifiedSignature(payload.signature);
      await verifyWalletSignature({
        address,
        nonce,
        signature,
      });

      const profiles = await loadAllProfiles();
      const bundle = buildLeaderboardBundle(profiles, now);
      const profilesByAddress = buildProfilesByAddress(profiles);
      const currentProfile = profilesByAddress.get(address) ?? null;
      if (bundle.weeklyWinnerAddress !== address) {
        return badRequest("Only the current weekly top ranker can update the marquee message", 403);
      }

      const weeklyState = parseWeeklyFbarsState(currentProfile, bundle.weekKey);
      if (weeklyState.marqueeEditCount >= WEEKLY_MARQUEE_MAX_EDITS) {
        return badRequest("Weekly marquee edit limit reached for this week", 403);
      }

      const weeklyMarqueeMessage = sanitizeWeeklyMarqueeMessage(ensureString(payload.weeklyMarqueeMessage, "weeklyMarqueeMessage"));
      nextSet.weeklyFbarsState = {
        ...weeklyState,
        weekKey: bundle.weekKey,
        marqueeEditCount: weeklyState.marqueeEditCount + 1,
      };
      if (weeklyMarqueeMessage) {
        nextSet.weeklyMarqueeMessage = weeklyMarqueeMessage;
        nextSet.weeklyMarqueeWeekKey = bundle.weekKey;
        nextSet.weeklyMarqueeUpdatedAt = now.toISOString();
      } else {
        nextSet.weeklyMarqueeMessage = null;
        nextSet.weeklyMarqueeWeekKey = null;
        nextSet.weeklyMarqueeUpdatedAt = null;
      }
    }

    if (payload.googleAccount !== undefined) {
      nextSet.googleAccount = googleAccount;
    }

    const result = await collection.updateOne(
      { address },
      {
        $set: nextSet,
        $setOnInsert: {
          createdAt: now,
          fbars: 0,
          adsfUsdCents: 0,
        },
      },
      { upsert: true }
    );

    if (result.matchedCount === 0 && result.upsertedCount === 0) {
      return badRequest("User profile not found", 404);
    }

    const profiles = await loadAllProfiles();
    const bundle = buildLeaderboardBundle(profiles, now);
    const profilesByAddress = buildProfilesByAddress(profiles);
    const profile = buildUserProfileResponse(address, bundle, profilesByAddress.get(address) ?? null)
      ?? buildFallbackUserProfileResponse(address, bundle, now);

    return NextResponse.json({
      profile: payload.googleAccount !== undefined ? attachGoogleAccountToProfile(profile, googleAccount) : profile,
      leaderboard: bundle.weeklyLeaderboard,
      weeklyLeaderboard: bundle.weeklyLeaderboard,
      overallLeaderboard: bundle.overallLeaderboard,
      ...buildActiveWeeklyMarquee(bundle, profilesByAddress),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update user profile";
    return badRequest(message);
  }
}
