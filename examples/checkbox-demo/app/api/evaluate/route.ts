import { NextResponse } from "next/server";

import { appId, evaluateSelections, parseSelectedPrinciples } from "@/lib/checkboxDemoApp";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const participantAddress = typeof payload.participantAddress === "string" ? payload.participantAddress.trim() : "";
    const externalUserId = typeof payload.externalUserId === "string" ? payload.externalUserId.trim() : "";
    if (!participantAddress || !externalUserId) {
      return NextResponse.json({ error: "participantAddress and externalUserId are required" }, { status: 400 });
    }

    const principleStates = await evaluateSelections({
      participantAddress,
      externalUserId,
      selectedPrinciples: parseSelectedPrinciples(payload.selectedPrinciples),
    });

    return NextResponse.json({
      ok: true,
      appId,
      participantAddress,
      externalUserId,
      principleStates,
      allFulfilled: principleStates.every((state) => state.fulfilled),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to evaluate demo principles";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
