import { NextResponse } from "next/server";

import {
  consumeGoogleLinkCode,
  getGoogleLinkCodeCookieName,
  parseGoogleLinkCookieValue,
} from "@/lib/googleAuth";
import { getUserProfilesCollection } from "@/lib/mongodb";

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

    const collection = await getUserProfilesCollection();
    const now = new Date();
    await collection.updateOne(
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
      googleAccount: linkRecord.googleAccount,
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
