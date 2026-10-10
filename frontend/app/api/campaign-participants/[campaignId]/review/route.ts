import { after, NextResponse } from "next/server";

import { SignerSignType } from "@ckb-ccc/core";

import { verifyWalletSignature } from "@/lib/googleAuth";
import { getCampaignParticipantsCollection, getMongoCollection } from "@/lib/mongodb";
import { dispatchMountedAppRequestsForParticipant, finalizeCampaignParticipant } from "@/lib/mountableAppRuntime";

export const dynamic = "force-dynamic";

type WalletSignaturePayload = {
  signature?: unknown;
  identity?: unknown;
  signType?: unknown;
};

type ReviewParticipantPayload = {
  participantAddress?: unknown;
  googleSub?: unknown;
  status?: unknown;
  reviewedByAddress?: unknown;
  reviewNote?: unknown;
  nonce?: unknown;
  nonceSignature?: WalletSignaturePayload | null;
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

function parseVerifiedSignature(signaturePayload: unknown) {
  if (!signaturePayload || typeof signaturePayload !== "object") {
    throw new Error("nonceSignature is required");
  }

  const signature = ensureString((signaturePayload as WalletSignaturePayload).signature, "nonceSignature.signature");
  const identity = ensureString((signaturePayload as WalletSignaturePayload).identity, "nonceSignature.identity");
  const signTypeValue = ensureString((signaturePayload as WalletSignaturePayload).signType, "nonceSignature.signType");
  if (!Object.values(SignerSignType).includes(signTypeValue as SignerSignType)) {
    throw new Error("Unsupported signer sign type");
  }

  return {
    signature,
    identity,
    signType: signTypeValue as SignerSignType,
  };
}

export async function PATCH(request: Request, context: RouteContext<"/api/campaign-participants/[campaignId]/review">) {
  try {
    const { campaignId } = await context.params;
    const normalizedCampaignId = campaignId.trim().toLowerCase();
    const payload = (await request.json()) as ReviewParticipantPayload;
    const reviewedByAddress = normalizeAddress(ensureString(payload.reviewedByAddress, "reviewedByAddress"));
    const nonce = ensureString(payload.nonce, "nonce");
    const nonceSignature = parseVerifiedSignature(payload.nonceSignature);
    await verifyWalletSignature({ address: reviewedByAddress, nonce, signature: nonceSignature });
    const status = ensureString(payload.status, "status").toLowerCase();
    if (status !== "verified" && status !== "rejected") {
      throw new Error("status must be verified or rejected");
    }

    const recordCollection = await getMongoCollection();
    const campaignRecord = await recordCollection.findOne({ campaignId: normalizedCampaignId }, { projection: { creatorAddress: 1 } });
    if (!campaignRecord?.creatorAddress || normalizeAddress(campaignRecord.creatorAddress) !== reviewedByAddress) {
      return badRequest("Only the campaign creator can review mounted participant claims", 403);
    }

    const googleSub = ensureOptionalString(payload.googleSub, "googleSub");
    const participantAddress = ensureOptionalString(payload.participantAddress, "participantAddress")?.toLowerCase() ?? null;
    if (!googleSub && !participantAddress) {
      throw new Error("googleSub or participantAddress is required");
    }

    const participantsCollection = await getCampaignParticipantsCollection();
    const now = new Date().toISOString();
    const participantQuery = googleSub
        ? { campaignId: normalizedCampaignId, googleSub }
        : { campaignId: normalizedCampaignId, participantAddress };
    const result = await participantsCollection.updateOne(
      participantQuery,
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

    const reviewedParticipant = await participantsCollection.findOne(
      participantQuery,
      { projection: { _id: 0, participantAddress: 1 } },
    ) as { participantAddress?: unknown } | null;
    const reviewedParticipantAddress = typeof reviewedParticipant?.participantAddress === "string"
      ? reviewedParticipant.participantAddress.trim().toLowerCase()
      : "";
    if (reviewedParticipantAddress) {
      after(async () => {
        const canonicalVerification = await finalizeCampaignParticipant({
          campaignId: normalizedCampaignId,
          participantAddress: reviewedParticipantAddress,
        });
        await dispatchMountedAppRequestsForParticipant({
          campaignId: normalizedCampaignId,
          participantAddress: reviewedParticipantAddress,
          canonicalVerification,
          eventType: canonicalVerification?.status === "verified" ? "participant.finalized" : "participant.updated",
          source: "participant-review",
        });
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to review participant claim";
    return badRequest(message);
  }
}
