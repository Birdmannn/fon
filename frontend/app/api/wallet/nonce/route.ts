import { NextResponse } from "next/server";

import { buildWalletActionNonce } from "@/lib/googleAuth";

export const dynamic = "force-dynamic";

type WalletNoncePayload = {
  address?: unknown;
  purpose?: unknown;
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
    const payload = (await request.json()) as WalletNoncePayload;
    const address = ensureString(payload.address, "address");
    const purpose = typeof payload.purpose === "string" && payload.purpose.trim().length > 0
      ? payload.purpose.trim().toLowerCase()
      : "wallet-action";

    return NextResponse.json({
      ok: true,
      nonce: buildWalletActionNonce(address, purpose),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create wallet nonce";
    return badRequest(message);
  }
}
