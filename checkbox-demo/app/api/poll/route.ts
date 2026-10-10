import { NextResponse } from "next/server";

import { appId, evaluateSelections, isValidRegistrationSecret, parseSelectedPrinciples } from "@/lib/checkboxDemoApp";
import { appendFlowLog } from "@/lib/flowLogs";
import type { PollMountableAppRequest } from "@/lib/fonSdk";

export async function POST(request: Request) {
  let payload: PollMountableAppRequest | null = null;
  try {
    if (!isValidRegistrationSecret(request)) {
      await appendFlowLog({ kind: "poll", direction: "inbound", method: "POST", source: "FON", target: "/api/poll", status: 403, summary: "Rejected poll with invalid registration secret" });
      return NextResponse.json({ error: "Invalid FON registration secret" }, { status: 403 });
    }
    const parsedPayload = await request.json() as PollMountableAppRequest;
    payload = parsedPayload;
    await appendFlowLog({ kind: "poll", direction: "inbound", method: "POST", source: "FON", target: "/api/poll", summary: `Polling ${parsedPayload.participants?.length ?? 0} participant(s)`, request: parsedPayload });
    const campaignId = parsedPayload.freight?.campaignId?.trim().toLowerCase() || "";
    if (parsedPayload.appId !== appId || !parsedPayload.mountableInstanceId || !campaignId) {
      return NextResponse.json({ error: "Invalid poll context" }, { status: 400 });
    }
    const now = new Date().toISOString();
    const updates = await Promise.all((parsedPayload.participants ?? []).map(async (participant) => ({
      appId,
      campaignId,
      participantAddress: participant.participantAddress,
      principleStates: await evaluateSelections({
        participantAddress: participant.participantAddress,
        externalUserId: participant.participantAddress,
        selectedPrinciples: parseSelectedPrinciples(parsedPayload.selectedPrinciples),
      }),
      effectiveAt: now,
      sourceUpdatedAt: now,
      statusMessage: "Evaluated by the checkbox demo poll endpoint",
    })));
    const responsePayload = { updates, polledAt: now };
    await appendFlowLog({ kind: "response", direction: "outbound", method: "POST", source: "/api/poll", target: "FON", status: 200, summary: `Returned ${updates.length} participant update(s)`, response: responsePayload });
    return NextResponse.json(responsePayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Poll failed";
    await appendFlowLog({ kind: "response", direction: "outbound", method: "POST", source: "/api/poll", target: "FON", status: 400, summary: message, request: payload, response: { error: message } });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Use authenticated POST polling" }, { status: 405 });
}
