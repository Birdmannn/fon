import { NextResponse } from "next/server";

import { getCampaignParticipantsCollection } from "@/lib/mongodb";

type CampaignParticipantPayload = {
  campaignId?: unknown;
  createdByHash?: unknown;
  chainCreatedAt?: unknown;
  campaignType?: unknown;
  participantAddress?: unknown;
  participantTxHash?: unknown;
  joinedAt?: unknown;
  status?: unknown;
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

function normalizePayload(payload: CampaignParticipantPayload) {
  const campaignId = ensureString(payload.campaignId, "campaignId").toLowerCase();
  const createdByHash = ensureString(payload.createdByHash, "createdByHash").toLowerCase();
  const chainCreatedAt = ensureString(payload.chainCreatedAt, "chainCreatedAt");
  const participantAddress = ensureString(payload.participantAddress, "participantAddress");
  const participantTxHash = ensureOptionalString(payload.participantTxHash, "participantTxHash")?.toLowerCase() ?? null;
  const joinedAt = ensureString(payload.joinedAt, "joinedAt");
  const status = ensureString(payload.status, "status").toLowerCase();
  const campaignType = typeof payload.campaignType === "number" ? payload.campaignType : Number(payload.campaignType);

  if (!Number.isInteger(campaignType)) {
    throw new Error("campaignType must be an integer");
  }

  if (!status) {
    throw new Error("status is required");
  }

  return {
    campaignId,
    createdByHash,
    chainCreatedAt,
    campaignType,
    participantAddress,
    participantTxHash,
    joinedAt,
    status,
  };
}

export async function POST(request: Request) {
  try {
    const payload = normalizePayload((await request.json()) as CampaignParticipantPayload);
    const collection = await getCampaignParticipantsCollection();
    const now = new Date();

    await collection.updateOne(
      payload.participantTxHash
        ? {
            campaignId: payload.campaignId,
            participantTxHash: payload.participantTxHash,
          }
        : {
            campaignId: payload.campaignId,
            participantAddress: payload.participantAddress,
            joinedAt: payload.joinedAt,
          },
      {
        $set: {
          ...payload,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to store campaign participant";
    return badRequest(message);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const campaignId = url.searchParams.get("campaignId")?.trim().toLowerCase();
    if (!campaignId) {
      return badRequest("campaignId is required");
    }

    const collection = await getCampaignParticipantsCollection();
    const participants = await collection
      .find({ campaignId }, { sort: { joinedAt: 1 } })
      .toArray();

    return NextResponse.json({ participants });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch campaign participants";
    return badRequest(message, 500);
  }
}
