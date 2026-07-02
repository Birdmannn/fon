import { NextResponse } from "next/server";

import { getCampaignParticipantsCollection, getMongoCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type ReviewParticipantPayload = {
  participantAddress?: unknown;
  googleSub?: unknown;
  status?: unknown;
  reviewedByAddress?: unknown;
  reviewNote?: unknown;
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

function ensureOptionalString(value: unknown, field: string) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${field} must be a string when provided`);
  }

  return value.trim();
}

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

export async function PATCH(request: Request, context: RouteContext<"/api/campaign-participants/[campaignId]/review">) {
  try {
    const { campaignId } = await context.params;
    const normalizedCampaignId = campaignId.trim().toLowerCase();
    const payload = (await request.json()) as ReviewParticipantPayload;
    const reviewedByAddress = normalizeAddress(ensureString(payload.reviewedByAddress, "reviewedByAddress"));
    const status = ensureString(payload.status, "status").toLowerCase();
    if (status !== "verified" && status !== "rejected") {
      throw new Error("status must be verified or rejected");
    }

    const recordCollection = await getMongoCollection();
    const campaignRecord = await recordCollection.findOne({ campaignId: normalizedCampaignId }, { projection: { creatorAddress: 1 } });
    if (!campaignRecord?.creatorAddress || normalizeAddress(campaignRecord.creatorAddress) !== reviewedByAddress) {
      return badRequest("Only the campaign creator can review forms claims", 403);
    }

    const googleSub = ensureOptionalString(payload.googleSub, "googleSub");
    const participantAddress = ensureOptionalString(payload.participantAddress, "participantAddress")?.toLowerCase() ?? null;
    if (!googleSub && !participantAddress) {
      throw new Error("googleSub or participantAddress is required");
    }

    const participantsCollection = await getCampaignParticipantsCollection();
    const now = new Date().toISOString();
    const result = await participantsCollection.updateOne(
      googleSub
        ? { campaignId: normalizedCampaignId, googleSub }
        : { campaignId: normalizedCampaignId, participantAddress },
      {
        $set: {
          status,
          reviewedAt: now,
          reviewedByAddress,
          reviewNote: ensureOptionalString(payload.reviewNote, "reviewNote"),
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return badRequest("Participant claim not found", 404);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to review participant claim";
    return badRequest(message);
  }
}
