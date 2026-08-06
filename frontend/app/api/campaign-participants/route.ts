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
  participantKind?: unknown;
  claimRole?: unknown;
  claimAmountShannons?: unknown;
  claimAmountLabel?: unknown;
  claimUnits?: unknown;
  claimSplitMode?: unknown;
  mountableType?: unknown;
  verificationProvider?: unknown;
  googleSub?: unknown;
  googleEmail?: unknown;
  googleEmailVerified?: unknown;
  submittedAt?: unknown;
  reviewedAt?: unknown;
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

function ensureOptionalBoolean(value: unknown, field: string) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean when provided`);
  }

  return value;
}

function ensureOptionalNumber(value: unknown, field: string) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a number when provided`);
  }

  return value;
}

function normalizePayload(payload: CampaignParticipantPayload) {
  const campaignId = ensureString(payload.campaignId, "campaignId").toLowerCase();
  const createdByHash = ensureString(payload.createdByHash, "createdByHash").toLowerCase();
  const chainCreatedAt = ensureString(payload.chainCreatedAt, "chainCreatedAt");
  const participantAddress = ensureString(payload.participantAddress, "participantAddress").toLowerCase();
  const participantTxHash = ensureOptionalString(payload.participantTxHash, "participantTxHash")?.toLowerCase() ?? null;
  const joinedAt = ensureString(payload.joinedAt, "joinedAt");
  const status = ensureString(payload.status, "status").toLowerCase();
  const campaignType = typeof payload.campaignType === "number" ? payload.campaignType : Number(payload.campaignType);
  const participantKind = ensureOptionalString(payload.participantKind, "participantKind")?.toLowerCase() ?? null;
  const claimRole = ensureOptionalString(payload.claimRole, "claimRole")?.toLowerCase() ?? null;
  const claimAmountShannons = ensureOptionalString(payload.claimAmountShannons, "claimAmountShannons");
  const claimAmountLabel = ensureOptionalString(payload.claimAmountLabel, "claimAmountLabel");
  const claimUnits = ensureOptionalNumber(payload.claimUnits, "claimUnits");
  const claimSplitMode = ensureOptionalString(payload.claimSplitMode, "claimSplitMode")?.toLowerCase() ?? null;
  const mountableType = ensureOptionalString(payload.mountableType, "mountableType")?.toLowerCase() ?? null;
  const verificationProvider = ensureOptionalString(payload.verificationProvider, "verificationProvider")?.toLowerCase() ?? null;
  const googleSub = ensureOptionalString(payload.googleSub, "googleSub");
  const googleEmail = ensureOptionalString(payload.googleEmail, "googleEmail")?.toLowerCase() ?? null;
  const googleEmailVerified = ensureOptionalBoolean(payload.googleEmailVerified, "googleEmailVerified");
  const submittedAt = ensureOptionalString(payload.submittedAt, "submittedAt");
  const reviewedAt = ensureOptionalString(payload.reviewedAt, "reviewedAt");
  const reviewedByAddress = ensureOptionalString(payload.reviewedByAddress, "reviewedByAddress")?.toLowerCase() ?? null;
  const reviewNote = ensureOptionalString(payload.reviewNote, "reviewNote");

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
    participantKind,
    claimRole,
    claimAmountShannons,
    claimAmountLabel,
    claimUnits,
    claimSplitMode,
    mountableType,
    verificationProvider,
    googleSub,
    googleEmail,
    googleEmailVerified,
    submittedAt,
    reviewedAt,
    reviewedByAddress,
    reviewNote,
  };
}

export async function POST(request: Request) {
  try {
    const payload = normalizePayload((await request.json()) as CampaignParticipantPayload);
    const collection = await getCampaignParticipantsCollection();
    const now = new Date();

    const query = payload.googleSub
      ? {
          campaignId: payload.campaignId,
          googleSub: payload.googleSub,
        }
      : payload.participantTxHash
        ? {
            campaignId: payload.campaignId,
            participantTxHash: payload.participantTxHash,
          }
        : {
            campaignId: payload.campaignId,
            participantAddress: payload.participantAddress,
            joinedAt: payload.joinedAt,
          };

    await collection.updateOne(
      query,
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
