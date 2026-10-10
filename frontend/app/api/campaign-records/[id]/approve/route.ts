import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Message signatures and database writes cannot approve a gift on-chain.
// The wallet now spends the gift cell through contract selector 13.
export async function POST() {
  return NextResponse.json({ error: "Gift approvals must be submitted as wallet transactions. Refresh the freight and use its on-chain Approve action." }, { status: 409 });
}
