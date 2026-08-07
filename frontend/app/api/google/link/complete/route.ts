import { NextResponse } from "next/server";

import {
  buildGoogleOAuthGrant,
  consumeGoogleLinkCode,
  parseStoredGoogleOAuthGrant,
  sanitizeGoogleOAuthGrantSummary,
  getGoogleLinkCodeCookieName,
  parseGoogleLinkCookieValue,
} from "@/lib/googleAuth";
import { getGoogleOAuthGrantsCollection, getUserProfilesCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type CompleteGoogleLinkPayload = {
  address?: unknown;
  code?: unknown;
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

function getCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const entry of cookieHeader.split(/;\s*/)) {
    const separator = entry.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = entry.slice(0, separator);
    if (key === name) {
      return entry.slice(separator + 1);
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as CompleteGoogleLinkPayload;
    const address = normalizeAddress(ensureString(payload.address, "address"));
    const code = ensureString(payload.code, "code").toUpperCase();
    const cookie = parseGoogleLinkCookieValue(getCookieValue(request, getGoogleLinkCodeCookieName()));

    if (!cookie || cookie.address !== address || cookie.code !== code) {
      return badRequest("Google link confirmation mismatch", 403);
    }

    const linkRecord = consumeGoogleLinkCode(code);
    if (!linkRecord || linkRecord.address !== address) {
      return badRequest("Google link confirmation expired", 403);
    }

    const profileCollection = await getUserProfilesCollection();
    const grantsCollection = await getGoogleOAuthGrantsCollection();
    const now = new Date();

    if (linkRecord.purpose === "forms_response_access") {
      if (!linkRecord.oauthGrant) {
        return badRequest("Google response-access grant is missing from this link session", 403);
      }

      const existingGrantDoc = await grantsCollection.findOne({
        address,
        grantKind: "forms_response_access",
      });
      const mergedGrant = buildGoogleOAuthGrant({
        grantKind: "forms_response_access",
        address,
        googleAccount: linkRecord.googleAccount,
        grantedScopes: linkRecord.oauthGrant.scopes,
        accessToken: linkRecord.oauthGrant.accessToken,
        accessTokenExpiresAt: linkRecord.oauthGrant.accessTokenExpiresAt,
        refreshToken: linkRecord.oauthGrant.refreshToken,
        tokenType: linkRecord.oauthGrant.tokenType,
        existingGrant: parseStoredGoogleOAuthGrant(existingGrantDoc?.grant ?? null),
      });

      await grantsCollection.updateOne(
        { address, grantKind: "forms_response_access" },
        {
          $set: {
            address,
            grantKind: "forms_response_access",
            googleSub: mergedGrant.googleAccount.sub,
            googleEmail: mergedGrant.googleAccount.email,
            grant: mergedGrant,
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true },
      );

      const response = NextResponse.json({
        ok: true,
        purpose: linkRecord.purpose,
        googleAccount: linkRecord.googleAccount,
        oauthGrant: sanitizeGoogleOAuthGrantSummary(mergedGrant),
      });
      response.cookies.set(getGoogleLinkCodeCookieName(), "", {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        maxAge: 0,
      });
      return response;
    }

    await profileCollection.updateOne(
      { address },
      {
        $set: {
          address,
          updatedAt: now,
          lastSeenAt: now,
          googleAccount: linkRecord.googleAccount,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true },
    );

    const response = NextResponse.json({
      ok: true,
      purpose: linkRecord.purpose,
      googleAccount: linkRecord.googleAccount,
      oauthGrant: null,
    });
    response.cookies.set(getGoogleLinkCodeCookieName(), "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to complete Google link";
    return badRequest(message);
  }
}
