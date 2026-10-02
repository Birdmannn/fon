import { NextResponse } from "next/server";

import { appId, evaluateSelections, isValidRegistrationSecret, parseSelectedPrinciples } from "@/lib/checkboxDemoApp";
import type { PollMountableAppRequest } from "@/lib/fonSdk";

export async function POST(request: Request) {
  try {
    if (!isValidRegistrationSecret(request)) {
      return NextResponse.json({ error: "Invalid FON registration secret" }, { status: 403 });
    }
    const payload = await request.json() as PollMountableAppRequest;
    const campaignId = payload.freight?.campaignId?.trim().toLowerCase() || "";
    if (payload.appId !== appId || !payload.mountableInstanceId || !campaignId) {
      return NextResponse.json({ error: "Invalid poll context" }, { status: 400 });
    }
    const now = new Date().toISOString();
    const updates = await Promise.all((payload.participants ?? []).map(async (participant) => ({
      appId,
      campaignId,
      participantAddress: participant.participantAddress,
      principleStates: await evaluateSelections({
        participantAddress: participant.participantAddress,
        externalUserId: participant.participantAddress,
        selectedPrinciples: parseSelectedPrinciples(payload.selectedPrinciples),
      }),
      effectiveAt: now,
      sourceUpdatedAt: now,
      statusMessage: "Evaluated by the checkbox demo poll endpoint",
    })));
    return NextResponse.json({ updates, polledAt: now });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Poll failed" }, { status: 400 });
  }
}

export async function GET() {
  return NextResponse.json({ error: "Use authenticated POST polling" }, { status: 405 });
}
