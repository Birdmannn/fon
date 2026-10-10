import { NextResponse } from "next/server";

import { getUserProfilesCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams.get("query")?.trim().replace(/^@+/, "") ?? "";
    const collection = await getUserProfilesCollection();
    const prefix = { $regex: `^${escapeRegex(query.replace(/\.ckb$/i, ""))}`, $options: "i" };
    const filter = query
      ? { username: prefix }
      : { username: { $type: "string" } };
    const profiles = await collection.find(filter, {
      projection: { _id: 0, username: 1, displayName: 1 },
      sort: { username: 1 },
      limit: 50,
    }).toArray();

    // Fill the remaining suggestions with name matches, after all handle matches.
    // Excluding matching usernames also avoids listing the same user twice.
    if (query && profiles.length < 50) {
      const displayNameMatches = await collection.find({
        displayName: prefix,
        username: { $type: "string", $not: prefix },
      }, {
        projection: { _id: 0, username: 1, displayName: 1 },
        sort: { displayName: 1, username: 1 },
        limit: 50 - profiles.length,
      }).toArray();
      profiles.push(...displayNameMatches);
    }

    return NextResponse.json({
      users: profiles.flatMap((profile) => {
        const username = typeof profile.username === "string" ? profile.username.trim().replace(/\.ckb$/i, "") : "";
        if (!username) return [];
        return [{
          username,
          handle: `@${username}.ckb`,
          displayName: typeof profile.displayName === "string" ? profile.displayName.trim() : "",
        }];
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load tag suggestions" }, { status: 500 });
  }
}
