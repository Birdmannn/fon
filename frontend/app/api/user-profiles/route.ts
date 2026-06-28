import { NextResponse } from "next/server";

import { getUserProfilesCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type UserProfilePayload = {
  address?: unknown;
  username?: unknown;
  displayName?: unknown;
};

type LeaderboardEntry = {
  address: string;
  username: string;
  handle: string;
  displayName: string;
  fbars: number;
  rank: number;
  updatedAt?: string | null;
  lastSeenAt?: string | null;
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

function buildLeaderboardEntry(profile: {
  address?: unknown;
  username?: unknown;
  displayName?: unknown;
  fbars?: unknown;
  updatedAt?: string | null;
  lastSeenAt?: string | null;
}): LeaderboardEntry {
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
    rank: 0,
    updatedAt: profile.updatedAt ?? null,
    lastSeenAt: profile.lastSeenAt ?? null,
  };
}

function buildRankedLeaderboard(profiles: Array<{
  address?: unknown;
  username?: unknown;
  displayName?: unknown;
  fbars?: unknown;
  updatedAt?: string | null;
  lastSeenAt?: string | null;
}>): LeaderboardEntry[] {
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const addressesParam = url.searchParams.get("addresses")?.trim();
    const addressParam = url.searchParams.get("address")?.trim();
    const handleParam = url.searchParams.get("handle")?.trim();
    const collection = await getUserProfilesCollection();

    if (handleParam) {
      const profiles = await collection
        .find({}, { projection: { _id: 0, address: 1, username: 1, displayName: 1, fbars: 1, updatedAt: 1, lastSeenAt: 1 } })
        .toArray();
      const leaderboard = buildRankedLeaderboard(profiles);
      const normalizedHandle = normalizeUsername(handleParam);
      const profile = leaderboard.find((entry) => normalizeUsername(entry.username) === normalizedHandle || normalizeUsername(entry.handle) === normalizedHandle);

      if (!profile) {
        return badRequest("User profile not found", 404);
      }

      return NextResponse.json({
        profile,
        leaderboard,
      });
    }

    const requestedAddresses = [
      ...(addressesParam ? addressesParam.split(",") : []),
      ...(addressParam ? [addressParam] : []),
    ]
      .map(normalizeAddress)
      .filter(Boolean);

    if (requestedAddresses.length === 0) {
      return badRequest("address, addresses, or handle is required");
    }

    const uniqueAddresses = Array.from(new Set(requestedAddresses));
    const profiles = await collection
      .find({ address: { $in: uniqueAddresses } }, { projection: { _id: 0, address: 1, username: 1, displayName: 1, fbars: 1, updatedAt: 1, lastSeenAt: 1 } })
      .toArray();

    return NextResponse.json({
      profiles: buildRankedLeaderboard(profiles),
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
          createdAt: now,
        },
      },
      { upsert: true }
    );

    const profiles = await collection
      .find({}, { projection: { _id: 0, address: 1, username: 1, displayName: 1, fbars: 1, updatedAt: 1, lastSeenAt: 1 } })
      .toArray();
    const leaderboard = buildRankedLeaderboard(profiles);
    const profile = leaderboard.find((entry) => entry.address === address) ?? {
      address,
      username: buildDefaultUsername(address),
      handle: formatUsernameHandle(buildDefaultUsername(address)),
      displayName: buildDefaultDisplayName(leaderboard.length),
      fbars: 0,
      rank: leaderboard.length + 1,
      updatedAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
    };

    return NextResponse.json({
      profile,
      leaderboard,
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
    const displayName = sanitizeDisplayName(ensureString(payload.displayName, "displayName"));

    const collection = await getUserProfilesCollection();
    const now = new Date();
    const result = await collection.updateOne(
      { address },
      {
        $set: {
          address,
          displayName,
          updatedAt: now,
          lastSeenAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    if (result.matchedCount === 0 && result.upsertedCount === 0) {
      return badRequest("User profile not found", 404);
    }

    const profiles = await collection
      .find({}, { projection: { _id: 0, address: 1, username: 1, displayName: 1, fbars: 1, updatedAt: 1, lastSeenAt: 1 } })
      .toArray();
    const leaderboard = buildRankedLeaderboard(profiles);
    const profile = leaderboard.find((entry) => entry.address === address) ?? {
      address,
      username: typeof payload.username === "string" ? sanitizeUsername(payload.username) : buildDefaultUsername(address),
      handle: formatUsernameHandle(typeof payload.username === "string" ? sanitizeUsername(payload.username) : buildDefaultUsername(address)),
      displayName,
      fbars: 0,
      rank: leaderboard.length + 1,
      updatedAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
    };

    return NextResponse.json({
      profile,
      leaderboard,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update user profile";
    return badRequest(message);
  }
}
