import { NextResponse } from "next/server";

import { getUserProfilesCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const address = url.searchParams.get("address")?.trim();
    if (!address) {
      return badRequest("address is required");
    }

    const collection = await getUserProfilesCollection();
    const profile = await collection.findOne(
      { address: normalizeAddress(address) },
      {
        projection: {
          _id: 0,
          googleAccount: 1,
        },
      },
    );

    return NextResponse.json({
      googleAccount: profile?.googleAccount ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch linked Google account";
    return badRequest(message, 500);
  }
}
