import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { SignerSignType } from "@ckb-ccc/core";

import {
  computeGiftPreviewAllocations,
  isGiftClaimOpen,
  matchesGiftHandle,
  parseStoredGiftDeliverable,
} from "@/lib/giftDeliverables";
import { verifyWalletSignature } from "@/lib/googleAuth";
import { getCampaignParticipantsCollection, getMongoCollection } from "@/lib/mongodb";
import { resolveTargetAddress } from "@/app/api/user-profiles/_lib/profileTarget";

export const dynamic = "force-dynamic";

type WalletSignaturePayload = {
  signature?: unknown;
  identity?: unknown;
  signType?: unknown;
};

type ClaimGiftPayload = {
  address?: unknown;
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

async function resolveClaimantAddress(entry: { address?: string | null; handle: string }) {
  if (typeof entry.address === "string" && entry.address.trim()) {
    return normalizeAddress(entry.address);
  }

  return resolveTargetAddress(null, entry.handle);
}

export async function POST(request: Request, context: RouteContext<"/api/campaign-records/[id]/claim">) {
  try {
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return badRequest("Invalid campaign record id", 404);
    }

    const payload = (await request.json()) as ClaimGiftPayload;
    const address = normalizeAddress(ensureString(payload.address, "address"));
    const nonce = ensureString(payload.nonce, "nonce");
    const nonceSignature = parseVerifiedSignature(payload.nonceSignature);
    await verifyWalletSignature({ address, nonce, signature: nonceSignature });

    const recordCollection = await getMongoCollection();
    const record = await recordCollection.findOne(
      { _id: new ObjectId(id) },
      {
        projection: {
          campaignId: 1,
          createdByHash: 1,
          chainCreatedAt: 1,
          campaignType: 1,
          argsDraft: 1,
          giftDeliverable: 1,
        },
      },
    );

    if (!record) {
      return badRequest("Campaign record not found", 404);
    }

    const giftDeliverable = parseStoredGiftDeliverable(record.giftDeliverable);
    if (!giftDeliverable.enabled) {
      return badRequest("Gift claiming is not enabled for this freight", 409);
    }

    if (!isGiftClaimOpen({
      chainCreatedAt: typeof record.chainCreatedAt === "string" ? record.chainCreatedAt : null,
      taskStartDelayHours: typeof record.argsDraft?.taskStartDelayHours === "string" ? record.argsDraft.taskStartDelayHours : null,
      giftDeliverable,
    })) {
      return badRequest("This gift freight has not commenced for claiming yet", 409);
    }

    let claimRole: "open" | "claimant" = "open";
    let resolvedClaimHandle: string | null = null;

    if (giftDeliverable.claimants.length > 0) {
      const resolvedClaimants = await Promise.all(
        giftDeliverable.claimants.map(async (entry) => ({
          ...entry,
          resolvedAddress: await resolveClaimantAddress(entry),
        })),
      );
      const matchedClaimant = resolvedClaimants.find((entry) => entry.resolvedAddress === address) ?? null;
      if (!matchedClaimant) {
        return badRequest("Only tagged claimants can claim this freight", 403);
      }

      claimRole = "claimant";
      resolvedClaimHandle = matchedClaimant.handle;
    }

    const preview = computeGiftPreviewAllocations({
      claimants: giftDeliverable.claimants,
      maxAmountCkb: typeof record.argsDraft?.maxAmountCkb === "string" ? record.argsDraft.maxAmountCkb : "0",
      rewardCount: typeof record.argsDraft?.rewardCount === "string" ? record.argsDraft.rewardCount : "1",
      ratioEntries: giftDeliverable.ratioEntries,
      splitMode: giftDeliverable.splitMode,
    });
    if (preview.error) {
      return badRequest(preview.error, 409);
    }

    let allocationAmountLabel = preview.perClaimAmountLabel;
    let allocationAmountShannons = preview.perClaimAmountShannons;
    let allocationUnits: number | null = null;

    if (claimRole === "claimant" && resolvedClaimHandle) {
      const matchedAllocation = preview.allocations.find((allocation) => matchesGiftHandle(allocation.handle, resolvedClaimHandle)) ?? null;
      if (!matchedAllocation) {
        return badRequest("Failed to derive a claimant allocation for this freight", 409);
      }
      allocationAmountLabel = matchedAllocation.amountLabel;
      allocationAmountShannons = matchedAllocation.amountShannons;
      allocationUnits = matchedAllocation.units;
    }

    const participantsCollection = await getCampaignParticipantsCollection();
    const now = new Date();
    await participantsCollection.updateOne(
      {
        campaignId: typeof record.campaignId === "string" ? record.campaignId.toLowerCase() : "",
        participantAddress: address,
        participantKind: "gift_claim",
      },
      {
        $set: {
          campaignId: typeof record.campaignId === "string" ? record.campaignId.toLowerCase() : "",
          createdByHash: typeof record.createdByHash === "string" ? record.createdByHash.toLowerCase() : "",
          chainCreatedAt: typeof record.chainCreatedAt === "string" ? record.chainCreatedAt : "",
          campaignType: typeof record.campaignType === "number" ? record.campaignType : Number(record.campaignType ?? 0),
          participantAddress: address,
          participantTxHash: null,
          joinedAt: now.toISOString(),
          status: "pending",
          participantKind: "gift_claim",
          claimRole,
          claimAmountShannons: allocationAmountShannons,
          claimAmountLabel: allocationAmountLabel,
          claimUnits: allocationUnits,
          claimSplitMode: giftDeliverable.splitMode,
          submittedAt: now.toISOString(),
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true },
    );

    return NextResponse.json({
      ok: true,
      claimRole,
      claimAmountLabel: allocationAmountLabel,
      claimAmountShannons: allocationAmountShannons,
      claimUnits: allocationUnits,
      claimSplitMode: giftDeliverable.splitMode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit gift claim";
    return badRequest(message);
  }
}
