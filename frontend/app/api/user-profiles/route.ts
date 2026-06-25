import { NextResponse } from "next/server";

import {
  buildDefaultUsername,
  formatUsernameHandle,
  normalizeUsername,
} from "@/lib/campaignDisplay";
import { getUserProfilesCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type UserProfilePayload = {
  address?: unknown;
  username?: unknown;
};

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
    throw new Error("username is required");
  }

  if (!/^[a-z0-9_-]+$/i.test(normalized)) {
    throw new Error("username may only contain letters, numbers, dashes, and underscores");
  }

  if (normalized.length < 3 || normalized.length > 32) {
    throw new Error("username must be between 3 and 32 characters");
  }

  return normalized;
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
    const requestedAddresses = [
      ...(addressesParam ? addressesParam.split(",") : []),
      ...(addressParam ? [addressParam] : []),
    ]
      .map(normalizeAddress)
      .filter(Boolean);

    if (requestedAddresses.length === 0) {
      return badRequest("address or addresses is required");
    }

    const uniqueAddresses = Array.from(new Set(requestedAddresses));
    const collection = await getUserProfilesCollection();
    const profiles = await collection
      .find({ address: { $in: uniqueAddresses } }, { projection: { _id: 0, address: 1, username: 1, updatedAt: 1, lastSeenAt: 1 } })
      .toArray();

    return NextResponse.json({
      profiles: profiles.map((profile) => ({
        address: typeof profile.address === "string" ? normalizeAddress(profile.address) : "",
        username: typeof profile.username === "string" ? profile.username : "",
        handle: typeof profile.username === "string" ? formatUsernameHandle(profile.username) : "",
        updatedAt: profile.updatedAt ?? null,
        lastSeenAt: profile.lastSeenAt ?? null,
      })),
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
          createdAt: now,
        },
      },
      { upsert: true }
    );

    const profile = await collection.findOne(
      { address },
      { projection: { _id: 0, address: 1, username: 1, updatedAt: 1, lastSeenAt: 1 } }
    );

    return NextResponse.json({
      profile: {
        address,
        username: typeof profile?.username === "string" ? profile.username : buildDefaultUsername(address),
        handle: formatUsernameHandle(typeof profile?.username === "string" ? profile.username : buildDefaultUsername(address)),
        updatedAt: profile?.updatedAt ?? now,
        lastSeenAt: profile?.lastSeenAt ?? now,
      },
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
    const username = sanitizeUsername(ensureString(payload.username, "username"));
    const duplicate = await findExistingUsernameOwner(username, address);

    if (duplicate) {
      return badRequest("That username is already taken", 409);
    }

    const collection = await getUserProfilesCollection();
    const now = new Date();
    const result = await collection.updateOne(
      { address },
      {
        $set: {
          address,
          username,
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

    return NextResponse.json({
      profile: {
        address,
        username,
        handle: formatUsernameHandle(username),
        updatedAt: now,
        lastSeenAt: now,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update user profile";
    return badRequest(message);
  }
}
