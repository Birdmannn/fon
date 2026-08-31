import { NextResponse } from "next/server";

import { finalizeCampaignParticipant } from "@/lib/mountableAppRuntime";

type FinalizeParticipantPayload = {
  campaignId?: unknown;
  participantAddress?: unknown;
};

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function ensureString(value: unknown, field: string) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }

  return value.trim();
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as FinalizeParticipantPayload;
    const campaignId = ensureString(payload.campaignId, "campaignId").toLowerCase();
    const participantAddress = ensureString(payload.participantAddress, "participantAddress").toLowerCase();

    const snapshot = await finalizeCampaignParticipant({ campaignId, participantAddress });
    if (!snapshot) {
      return badRequest("Participant or campaign record not found", 404);
    }

    return NextResponse.json({ ok: true, canonicalVerification: snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to finalize campaign participant";
    return badRequest(message);
  }
}
