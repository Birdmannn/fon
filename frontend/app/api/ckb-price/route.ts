import { NextResponse } from "next/server";

import { fetchCkbUsdPrice } from "@/lib/ckbPrice";

export const dynamic = "force-dynamic";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    const usd = await fetchCkbUsdPrice();
    return NextResponse.json({ usd });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch CKB price";
    return badRequest(message, 500);
  }
}
