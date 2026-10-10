import { NextResponse } from "next/server";

import { appId, evaluateSelections, installationIsActive, listInstallations, readParticipantState, saveParticipantState } from "@/lib/checkboxDemoApp";
import { appendFlowLog } from "@/lib/flowLogs";
import { sendParticipantUpdateToUrl } from "@/lib/fonSdk";
import { getJoyIdSession } from "@/lib/joyidSession";

export async function GET(request: Request) {
  const session = await getJoyIdSession(request);
  if (!session) return NextResponse.json({ error: "Connect JoyID first" }, { status: 401 });
  const url = new URL(request.url);
  const externalUserId = session.address;
  const participantAddress = session.address;
  const state = await readParticipantState(externalUserId, participantAddress);
  const requestedMountableInstanceId = url.searchParams.get("mountableInstanceId")?.trim() || "";
  const availableInstallations = await listInstallations();
  const installation = availableInstallations.find((entry) => entry.mountableInstanceId === requestedMountableInstanceId)
    ?? availableInstallations.filter((entry) => installationIsActive(entry)).at(-1)
    ?? availableInstallations.at(-1);
  const principleStates = await evaluateSelections({ ...state, selectedPrinciples: installation?.selectedPrinciples });
  const responsePayload = { ok: true, state, principleStates, mountableInstanceId: installation?.mountableInstanceId ?? "" };
  await appendFlowLog({ kind: "response", direction: "internal", method: "GET", source: "/api/participant-state", target: session.address, status: 200, summary: "Loaded wallet activity state", response: responsePayload });
  return NextResponse.json(responsePayload);
}

export async function POST(request: Request) {
  let payload: Record<string, unknown> | null = null;
  try {
    const session = await getJoyIdSession(request);
    if (!session) return NextResponse.json({ error: "Connect JoyID first" }, { status: 401 });
    payload = await request.json();
    if (!payload) throw new Error("Participant activity payload is required");
    const externalUserId = session.address;
    const participantAddress = session.address;
    const checked = Array.isArray(payload.checked) ? payload.checked : [];
    const requestedMountableInstanceId = typeof payload.mountableInstanceId === "string" ? payload.mountableInstanceId.trim() : "";
    await appendFlowLog({ kind: "request", direction: "inbound", method: "POST", source: session.address, target: "/api/participant-state", summary: "Wallet activity changed", request: { ...payload, externalUserId, participantAddress } });

    const submittedText = typeof payload.submittedText === "string" ? payload.submittedText : "";
    const state = await saveParticipantState({ externalUserId, participantAddress, checked, submittedText });
    const availableInstallations = await listInstallations();
    const installation = availableInstallations.find((entry) => entry.mountableInstanceId === requestedMountableInstanceId)
      ?? availableInstallations.filter((entry) => installationIsActive(entry)).at(-1)
      ?? availableInstallations.at(-1);
    const principleStates = await evaluateSelections({ ...state, selectedPrinciples: installation?.selectedPrinciples });
    const syncResults = await Promise.all(availableInstallations
      .filter((installation) => installation.campaignId && installationIsActive(installation))
      .map(async (installation) => {
        const installationStates = await evaluateSelections({
          ...state,
          selectedPrinciples: installation.selectedPrinciples,
        });
        try {
          const webhookPayload = {
            appId,
            campaignId: installation.campaignId,
            participantAddress: state.participantAddress,
            principleStates: installationStates,
            effectiveAt: state.updatedAt,
            sourceUpdatedAt: state.updatedAt,
            statusMessage: installationStates.every((principle) => principle.fulfilled)
              ? "All required checkbox principles are fulfilled"
              : "Checkbox principles are still pending",
          };
          await appendFlowLog({ kind: "webhook", direction: "outbound", method: "POST", source: appId, target: installation.updateWebhookUrl, summary: `Sending participant update for freight ${installation.campaignId}`, request: webhookPayload });
          const webhookResponse = await sendParticipantUpdateToUrl(installation.updateWebhookUrl, webhookPayload, installation.sharedSecret);
          await appendFlowLog({ kind: "response", direction: "inbound", method: "POST", source: "FON", target: appId, status: 200, summary: `FON accepted participant update for freight ${installation.campaignId}`, response: webhookResponse });
          return { mountableInstanceId: installation.mountableInstanceId, ok: true };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await appendFlowLog({ kind: "response", direction: "inbound", method: "POST", source: "FON", target: appId, status: 502, summary: `Participant update failed: ${message}`, response: { error: message } });
          return { mountableInstanceId: installation.mountableInstanceId, ok: false, error: message };
        }
      }));
    const responsePayload = {
      ok: true,
      state,
      principleStates,
      allFulfilled: principleStates.every((principle) => principle.fulfilled),
      mountableInstanceId: installation?.mountableInstanceId ?? "",
      syncResults,
    };
    await appendFlowLog({ kind: "evaluation", direction: "internal", method: "POST", source: appId, target: state.participantAddress, status: 200, summary: responsePayload.allFulfilled ? "All selected principles fulfilled" : "Principles evaluated with pending items", response: responsePayload });
    return NextResponse.json(responsePayload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save participant state";
    await appendFlowLog({ kind: "response", direction: "internal", method: "POST", source: "/api/participant-state", target: "browser", status: 400, summary: message, request: payload, response: { error: message } });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
