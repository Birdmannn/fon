import { NextResponse } from "next/server";

import { buildGoogleNonce } from "@/lib/googleAuth";

export const dynamic = "force-dynamic";

type GoogleLinkNoncePayload = {
  address?: unknown;
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

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as GoogleLinkNoncePayload;
    const address = ensureString(payload.address, "address");
    return NextResponse.json({
      ok: true,
      nonce: buildGoogleNonce(address),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create Google link nonce";
    return badRequest(message);
  }
}
