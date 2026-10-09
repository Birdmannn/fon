import { NextResponse } from "next/server";

// Gift claims must spend the live campaign and pay the signed claiming wallet.
// A signed web request or database row is never a substitute for this transition.
export async function POST() {
  return NextResponse.json({ error: "Claim this gift with a wallet transaction. Refresh the freight and use Claim. Older gifts must be recreated with on-chain claim rules." }, { status: 409 });
}
