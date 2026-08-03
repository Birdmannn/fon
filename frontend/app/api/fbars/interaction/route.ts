import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { SignerSignType } from "@ckb-ccc/core";

import {
  awardFbarsEvent,
  getCurrentWeekKey,
  isWinningCampaignType,
} from "@/lib/fbars";
import { verifyWalletSignature } from "@/lib/googleAuth";
import { getFbarEventsCollection, getMongoCollection, getUserProfilesCollection } from "@/lib/mongodb";

type WalletSignaturePayload = {
  signature?: unknown;
  identity?: unknown;
  signType?: unknown;
};

type InteractionPayload = {
  address?: unknown;
  nonce?: unknown;
  nonceSignature?: WalletSignaturePayload | null;
  recordId?: unknown;
  actionType?: unknown;
  commentCreatedAt?: unknown;
  commentText?: unknown;
};

type CampaignRecordShape = {
  creatorAddress?: unknown;
  campaignType?: unknown;
  socialMetadata?: {
    likedByAddresses?: unknown;
    resharedByAddresses?: unknown;
    comments?: unknown;
  };
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

function hasPersistedLike(record: CampaignRecordShape, actorAddress: string) {
  return Array.isArray(record.socialMetadata?.likedByAddresses)
    && record.socialMetadata.likedByAddresses.some((value) => typeof value === "string" && normalizeAddress(value) === actorAddress);
}

function hasPersistedReshare(record: CampaignRecordShape, actorAddress: string) {
  return Array.isArray(record.socialMetadata?.resharedByAddresses)
    && record.socialMetadata.resharedByAddresses.some((value) => typeof value === "string" && normalizeAddress(value) === actorAddress);
}

function hasPersistedComment(record: CampaignRecordShape, actorAddress: string, commentCreatedAt: string, commentText: string) {
  return Array.isArray(record.socialMetadata?.comments)
    && record.socialMetadata.comments.some((value) => {
      if (!value || typeof value !== "object") {
        return false;
      }

      const candidate = value as { creatorAddress?: unknown; createdAt?: unknown; text?: unknown };
      return typeof candidate.creatorAddress === "string"
        && typeof candidate.createdAt === "string"
        && typeof candidate.text === "string"
        && normalizeAddress(candidate.creatorAddress) === actorAddress
        && candidate.createdAt.trim() === commentCreatedAt
        && candidate.text.trim() === commentText;
    });
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as InteractionPayload;
    const address = normalizeAddress(ensureString(payload.address, "address"));
    const nonce = ensureString(payload.nonce, "nonce");
    const nonceSignature = parseVerifiedSignature(payload.nonceSignature);
    await verifyWalletSignature({ address, nonce, signature: nonceSignature });

    const recordId = ensureString(payload.recordId, "recordId");
    if (!ObjectId.isValid(recordId)) {
      throw new Error("recordId must be a valid ObjectId");
    }

    const actionType = ensureString(payload.actionType, "actionType").toLowerCase();
    if (!["like", "comment", "reshare"].includes(actionType)) {
      throw new Error("actionType must be like, comment, or reshare");
    }

    const recordsCollection = await getMongoCollection();
    const record = await recordsCollection.findOne(
      { _id: new ObjectId(recordId) },
      {
        projection: {
          _id: 0,
          creatorAddress: 1,
          campaignType: 1,
          socialMetadata: 1,
        },
      },
    ) as CampaignRecordShape | null;
    if (!record) {
      return badRequest("Campaign record not found", 404);
    }

    if (actionType === "like" && !hasPersistedLike(record, address)) {
      return badRequest("Like action has not been persisted on the campaign record", 409);
    }
    if (actionType === "reshare" && !hasPersistedReshare(record, address)) {
      return badRequest("Reshare action has not been persisted on the campaign record", 409);
    }
    const commentCreatedAt = typeof payload.commentCreatedAt === "string" ? payload.commentCreatedAt.trim() : "";
    const commentText = typeof payload.commentText === "string" ? payload.commentText.trim() : "";
    if (actionType === "comment" && !hasPersistedComment(record, address, commentCreatedAt, commentText)) {
      return badRequest("Comment action has not been persisted on the campaign record", 409);
    }

    const creatorAddress = typeof record.creatorAddress === "string" ? normalizeAddress(record.creatorAddress) : "";
    const campaignType = typeof record.campaignType === "number" ? record.campaignType : Number(record.campaignType ?? 0);
    const creatorEventKind = isWinningCampaignType(campaignType) ? "creator-winning-interaction" : "creator-non-winning-interaction";
    const weekKey = getCurrentWeekKey(new Date());
    const [profilesCollection, eventsCollection] = await Promise.all([
      getUserProfilesCollection(),
      getFbarEventsCollection(),
    ]);

    const actorEventSuffix = actionType === "comment"
      ? `${commentCreatedAt}:${commentText}`
      : address;
    const actorResult = await awardFbarsEvent({
      address,
      weekKey,
      eventKey: `interaction:${actionType}:${recordId}:${actorEventSuffix}`,
      kind: "interaction",
      delta: 0,
      metadata: {
        recordId,
        actionType,
      },
      profilesCollection,
      eventsCollection,
    });

    let creatorApplied = false;
    if (creatorAddress) {
      const creatorResult = await awardFbarsEvent({
        address: creatorAddress,
        weekKey,
        eventKey: `creator-interaction:${actionType}:${recordId}:${actorEventSuffix}`,
        kind: creatorEventKind,
        delta: 0,
        metadata: {
          actorAddress: address,
          recordId,
          actionType,
          campaignType,
        },
        profilesCollection,
        eventsCollection,
      });
      creatorApplied = creatorResult.applied;
    }

    return NextResponse.json({
      ok: true,
      actionType,
      actorApplied: actorResult.applied,
      creatorApplied,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to award interaction FBARS";
    return badRequest(message);
  }
}
