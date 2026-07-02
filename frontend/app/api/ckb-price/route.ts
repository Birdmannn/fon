import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CKB_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price?ids=nervos-network&vs_currencies=usd";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    const response = await fetch(CKB_PRICE_URL, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(typeof payload?.error === "string" ? payload.error : "Failed to fetch CKB price");
    }

    const usd = payload?.["nervos-network"]?.usd;
    if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) {
      throw new Error("Invalid CKB USD price returned from CoinGecko");
    }

    return NextResponse.json({ usd });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch CKB price";
    return badRequest(message, 500);
  }
}
