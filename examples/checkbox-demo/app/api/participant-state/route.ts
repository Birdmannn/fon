import { NextResponse } from "next/server";

import { appId, evaluateSelections, installationIsActive, listInstallations, readParticipantState, saveParticipantState } from "@/lib/checkboxDemoApp";
import { sendParticipantUpdateToUrl } from "@/lib/fonSdk";

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
    const syncResults = await Promise.all(listInstallations()
      .filter((installation) => installation.campaignId && installationIsActive(installation))
      .map(async (installation) => {
        const installationStates = await evaluateSelections({
          ...state,
          selectedPrinciples: installation.selectedPrinciples,
        });
        try {
          await sendParticipantUpdateToUrl(installation.updateWebhookUrl, {
            appId,
            campaignId: installation.campaignId,
            participantAddress: state.participantAddress,
            principleStates: installationStates,
            effectiveAt: state.updatedAt,
            sourceUpdatedAt: state.updatedAt,
            statusMessage: installationStates.every((principle) => principle.fulfilled)
              ? "All required checkbox principles are fulfilled"
              : "Checkbox principles are still pending",
          }, installation.sharedSecret);
          return { mountableInstanceId: installation.mountableInstanceId, ok: true };
        } catch (error) {
          return { mountableInstanceId: installation.mountableInstanceId, ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }));
    return NextResponse.json({
      ok: true,
      state,
      principleStates,
      allFulfilled: principleStates.every((principle) => principle.fulfilled),
      syncResults,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save participant state";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
