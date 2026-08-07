import { NextResponse } from "next/server";

import { normalizeGoogleLinkPurpose, parseStoredGoogleOAuthGrant, sanitizeGoogleOAuthGrantSummary } from "@/lib/googleAuth";
import { getGoogleOAuthGrantsCollection, getUserProfilesCollection } from "@/lib/mongodb";

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

    const purpose = normalizeGoogleLinkPurpose(url.searchParams.get("purpose"));
    const normalizedAddress = normalizeAddress(address);

    if (purpose === "forms_response_access") {
      const grantsCollection = await getGoogleOAuthGrantsCollection();
      const grantDoc = await grantsCollection.findOne(
        { address: normalizedAddress, grantKind: "forms_response_access" },
        {
          projection: {
            _id: 0,
            grant: 1,
          },
        },
      );

      return NextResponse.json({
        purpose,
        googleAccount: null,
        oauthGrant: sanitizeGoogleOAuthGrantSummary(parseStoredGoogleOAuthGrant(grantDoc?.grant ?? null)),
      });
    }

    const collection = await getUserProfilesCollection();
    const profile = await collection.findOne(
      { address: normalizedAddress },
      {
        projection: {
          _id: 0,
          googleAccount: 1,
        },
      },
    );

    return NextResponse.json({
      purpose,
      googleAccount: profile?.googleAccount ?? null,
      oauthGrant: null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch linked Google account";
    return badRequest(message, 500);
  }
}
