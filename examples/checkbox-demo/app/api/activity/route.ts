import { NextResponse } from "next/server";

import { evaluateSelections, parseSelectedPrinciples } from "@/lib/checkboxDemoApp";

export async function POST(request: Request) {
  try {
    const event = await request.json();
    const participantAddress = typeof event.participant?.participantAddress === "string"
      ? event.participant.participantAddress.trim()
      : "";
    if (!participantAddress) {
      return NextResponse.json({ error: "event.participant.participantAddress is required" }, { status: 400 });
    }

    const externalUserId = typeof event.participant?.externalUserId === "string"
      ? event.participant.externalUserId.trim()
      : participantAddress;
    const principleStates = await evaluateSelections({
      participantAddress,
      externalUserId,
      selectedPrinciples: parseSelectedPrinciples(event.selectedPrinciples),
    });

    return NextResponse.json({
      ok: true,
      eventId: typeof event.eventId === "string" ? event.eventId : null,
      principleStates,
      allFulfilled: principleStates.every((state) => state.fulfilled),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process activity event";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
