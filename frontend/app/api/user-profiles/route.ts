import { NextResponse } from "next/server";

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
  weeklyMarqueeMessage: 1,
  weeklyMarqueeWeekKey: 1,
  weeklyMarqueeUpdatedAt: 1,
} as const;

type UserProfilePayload = {
  address?: unknown;
  username?: unknown;
  displayName?: unknown;
  adsfUsdCents?: unknown;
  weeklyMarqueeMessage?: unknown;
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

type StoredProfileRecord = {
  address?: unknown;
  username?: unknown;
  displayName?: unknown;
  fbars?: unknown;
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
  googleAccount?: GoogleAccountProfile | null;
};

type ActiveWeeklyMarqueeResponse = {
  activeWeeklyMarqueeMessage: string | null;
  activeWeeklyMarqueeOwner: WeeklyMarqueeOwner | null;
  activeWeeklyMarqueeWeekKey: string;
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

function sanitizeUsername(value: string) {
  const normalized = value.trim().replace(/\.ckb$/i, "");
  if (!normalized) {
    throw new Error("handle is required");
  }

  if (!/^[a-z0-9_-]+$/i.test(normalized)) {
    throw new Error("handle may only contain letters, numbers, dashes, and underscores");
  }

  if (normalized.length < 3 || normalized.length > 32) {
    throw new Error("handle must be between 3 and 32 characters");
  }

  return normalized;
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
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return 0;
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

function buildLeaderboardEntry(profile: StoredProfileRecord): LeaderboardEntry {
  const address = typeof profile.address === "string" ? normalizeAddress(profile.address) : "";
  const username = typeof profile.username === "string" && profile.username.trim().length > 0
    ? profile.username.trim()
    : buildDefaultUsername(address);

  return {
    address,
    username,
    handle: formatUsernameHandle(username),
    displayName: typeof profile.displayName === "string" && profile.displayName.trim().length > 0
      ? profile.displayName.trim()
      : username,
    fbars: parseFbars(profile.fbars),
    adsfUsdCents: parseAdsfUsdCents(profile.adsfUsdCents),
    rank: 0,
    updatedAt: profile.updatedAt ?? null,
    lastSeenAt: profile.lastSeenAt ?? null,
  };
}

function buildRankedLeaderboard(profiles: StoredProfileRecord[]): LeaderboardEntry[] {
  return profiles
    .map(buildLeaderboardEntry)
    .sort((left, right) => {
      if (right.fbars !== left.fbars) {
        return right.fbars - left.fbars;
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

function getUtcCalendarWeekStart(value = new Date()) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  const dayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayOffset);
  return date;
}

function getCurrentWeekKey(value = new Date()) {
  return getUtcCalendarWeekStart(value).toISOString().slice(0, 10);
}

function buildLeaderboardBundle(profiles: StoredProfileRecord[], now = new Date()): LeaderboardBundle {
  const overallLeaderboard = buildRankedLeaderboard(profiles);
  const weeklyLeaderboard = buildRankedLeaderboard(profiles);

  return {
    overallLeaderboard,
    weeklyLeaderboard,
    weekKey: getCurrentWeekKey(now),
    weeklyWinnerAddress: weeklyLeaderboard[0]?.address ?? null,
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
    adsfUsdCents: 0,
    rank: bundle.weeklyLeaderboard.length + 1,
    weeklyRank: bundle.weeklyLeaderboard.length + 1,
    overallRank: bundle.overallLeaderboard.length + 1,
    canEditWeeklyMarquee: false,
    weeklyMarqueeMessage: null,
    weeklyMarqueeWeekKey: null,
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

  return {
    ...baseEntry,
    weeklyRank: weeklyEntry?.rank ?? 0,
    overallRank: overallEntry?.rank ?? 0,
    canEditWeeklyMarquee: bundle.weeklyWinnerAddress === baseEntry.address,
    weeklyMarqueeMessage,
    weeklyMarqueeWeekKey,
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

  if (!winner || !weeklyMarqueeMessage || weeklyMarqueeWeekKey !== bundle.weekKey) {
    return {
      activeWeeklyMarqueeMessage: null,
      activeWeeklyMarqueeOwner: null,
      activeWeeklyMarqueeWeekKey: bundle.weekKey,
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
  };
}

async function findExistingUsernameOwner(username: string, address: string) {
  const collection = await getUserProfilesCollection();
  const normalizedUsername = normalizeUsername(username);
  const matches = await collection.find({}, { projection: { address: 1, username: 1 } }).toArray();

  return matches.find((profile) => {
    const profileAddress = typeof profile.address === "string" ? normalizeAddress(profile.address) : "";
    const profileUsername = typeof profile.username === "string" ? normalizeUsername(profile.username) : "";
    return profileAddress !== address && profileUsername === normalizedUsername;
  }) ?? null;
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
    const leaderboard = buildRankedLeaderboard(profiles);

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
          weeklyRank: entry.rank,
          overallRank: entry.rank,
          canEditWeeklyMarquee: false,
          weeklyMarqueeMessage: null,
          weeklyMarqueeWeekKey: null,
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
      const profiles = await loadAllProfiles();
      const bundle = buildLeaderboardBundle(profiles, now);
      if (bundle.weeklyWinnerAddress !== address) {
        return badRequest("Only the current weekly top ranker can update the marquee message", 403);
      }

      const weeklyMarqueeMessage = sanitizeWeeklyMarqueeMessage(ensureString(payload.weeklyMarqueeMessage, "weeklyMarqueeMessage"));
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
