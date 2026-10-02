import { NextResponse } from "next/server";

import { evaluateSelections, isValidRegistrationSecret, parseSelectedPrinciples, saveInstallation } from "@/lib/checkboxDemoApp";

export async function POST(request: Request) {
  try {
    if (!isValidRegistrationSecret(request)) {
      return NextResponse.json({ error: "Invalid FON registration secret" }, { status: 403 });
    }
    const event = await request.json();
    if (event.eventType === "mount.requested") {
      const mountableInstanceId = typeof event.mountableInstanceId === "string" ? event.mountableInstanceId.trim() : "";
      const campaignId = typeof event.freight?.campaignId === "string" ? event.freight.campaignId.trim().toLowerCase() : "";
      const validFrom = typeof event.eventWebhook?.validFrom === "string" ? event.eventWebhook.validFrom.trim() : "";
      const validUntil = typeof event.eventWebhook?.validUntil === "string" ? event.eventWebhook.validUntil.trim() : "";
      const timeframeSeconds = typeof event.eventWebhook?.timeframeSeconds === "number" ? event.eventWebhook.timeframeSeconds : 0;
      const updateWebhookUrl = typeof event.eventWebhook?.url === "string" ? event.eventWebhook.url.trim() : "";
      const sharedSecret = typeof event.eventWebhook?.secret === "string" ? event.eventWebhook.secret.trim() : "";
      if (!mountableInstanceId || !campaignId || !validFrom || !validUntil || timeframeSeconds <= 0 || !updateWebhookUrl || !sharedSecret) {
        return NextResponse.json({ error: "Invalid mount request" }, { status: 400 });
      }
      saveInstallation({
        installationId: mountableInstanceId,
        mountableInstanceId,
        campaignId,
        sharedSecret,
        updateWebhookUrl,
        validFrom,
        validUntil,
        timeframeSeconds,
        selectedPrinciples: parseSelectedPrinciples(event.selectedPrinciples),
      });
      return NextResponse.json({ ok: true, mounted: true, eventId: event.eventId ?? null });
    }
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
