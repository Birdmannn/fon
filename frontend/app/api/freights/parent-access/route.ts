import { NextResponse } from "next/server";

import { assertFreightParentAccess } from "@/lib/mountableAppRuntime";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as { campaignId?: unknown; participantAddress?: unknown };
    if (typeof payload.campaignId !== "string" || typeof payload.participantAddress !== "string") {
      return NextResponse.json({ error: "Freight and wallet address are required" }, { status: 400 });
    }
    await assertFreightParentAccess(payload.campaignId, payload.participantAddress);
    return NextResponse.json({ allowed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not check parent freight completion";
    const status = message === "Published freight record not found" ? 404
      : message.startsWith("Complete ") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
