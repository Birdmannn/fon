import { NextResponse } from "next/server";

import { evaluateSelections, readParticipantState, saveParticipantState } from "@/lib/checkboxDemoApp";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const externalUserId = url.searchParams.get("externalUserId")?.trim() || "demo-user";
  const participantAddress = url.searchParams.get("participantAddress")?.trim() || undefined;
  const state = readParticipantState(externalUserId, participantAddress);
  const principleStates = await evaluateSelections(state);
  return NextResponse.json({ ok: true, state, principleStates });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const externalUserId = typeof payload.externalUserId === "string" ? payload.externalUserId.trim() : "";
    const participantAddress = typeof payload.participantAddress === "string" ? payload.participantAddress.trim() : undefined;
    const checked = Array.isArray(payload.checked) ? payload.checked : [];
    if (!externalUserId) {
      return NextResponse.json({ error: "externalUserId is required" }, { status: 400 });
    }

    const state = saveParticipantState({ externalUserId, participantAddress, checked });
    const principleStates = await evaluateSelections(state);
    return NextResponse.json({
      ok: true,
      state,
      principleStates,
      allFulfilled: principleStates.every((principle) => principle.fulfilled),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save participant state";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
