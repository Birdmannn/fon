import { NextResponse } from "next/server";

import { appId, evaluateSelections, parseSelectedPrinciples } from "@/lib/checkboxDemoApp";
import { appendFlowLog } from "@/lib/flowLogs";

export async function POST(request: Request) {
  let payload: Record<string, unknown> | null = null;
  try {
    payload = await request.json();
    if (!payload) throw new Error("Evaluation payload is required");
    appendFlowLog({ kind: "request", direction: "inbound", method: "POST", source: "FON/client", target: "/api/evaluate", summary: "Received direct principle evaluation request", request: payload });
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

    const responsePayload = {
      ok: true,
      appId,
      participantAddress,
      externalUserId,
      principleStates,
      allFulfilled: principleStates.every((state) => state.fulfilled),
    };
    appendFlowLog({ kind: "evaluation", direction: "outbound", method: "POST", source: "/api/evaluate", target: "FON/client", status: 200, summary: "Returned direct principle evaluation", response: responsePayload });
    return NextResponse.json(responsePayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to evaluate demo principles";
    appendFlowLog({ kind: "response", direction: "outbound", method: "POST", source: "/api/evaluate", target: "FON/client", status: 400, summary: message, request: payload, response: { error: message } });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
