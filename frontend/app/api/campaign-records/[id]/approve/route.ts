import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { SignerSignType } from "@ckb-ccc/core";

import {
  deriveRequiredApprovalCount,
  parseStoredGiftDeliverable,
  type GiftApprovalRecord,
} from "@/lib/giftDeliverables";
import { verifyWalletSignature } from "@/lib/googleAuth";
import { getMongoCollection } from "@/lib/mongodb";
import { resolveTargetAddress } from "@/app/api/user-profiles/_lib/profileTarget";

export const dynamic = "force-dynamic";

type WalletSignaturePayload = {
  signature?: unknown;
  identity?: unknown;
  signType?: unknown;
};

type ApproveGiftPayload = {
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

async function resolveTaggedAddress(taggedUser: { address?: string | null; handle: string }) {
  if (typeof taggedUser.address === "string" && taggedUser.address.trim()) {
    return normalizeAddress(taggedUser.address);
  }

  return resolveTargetAddress(null, taggedUser.handle);
}

export async function POST(request: Request, context: RouteContext<"/api/campaign-records/[id]/approve">) {
  try {
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return badRequest("Invalid campaign record id", 404);
    }

    const payload = (await request.json()) as ApproveGiftPayload;
    const address = normalizeAddress(ensureString(payload.address, "address"));
    const nonce = ensureString(payload.nonce, "nonce");
    const nonceSignature = parseVerifiedSignature(payload.nonceSignature);
    await verifyWalletSignature({ address, nonce, signature: nonceSignature });

    const collection = await getMongoCollection();
    const record = await collection.findOne(
      { _id: new ObjectId(id) },
      {
        projection: {
          campaignId: 1,
          giftDeliverable: 1,
        },
      },
    );

    if (!record) {
      return badRequest("Campaign record not found", 404);
    }

    const giftDeliverable = parseStoredGiftDeliverable(record.giftDeliverable);
    if (!giftDeliverable.enabled) {
      return badRequest("Gift approvals are not enabled for this freight", 409);
    }

    if (giftDeliverable.approvers.length === 0) {
      return badRequest("This freight does not require approvals", 409);
    }

    const resolvedApproverEntries = await Promise.all(
      giftDeliverable.approvers.map(async (entry) => ({
        ...entry,
        resolvedAddress: await resolveTaggedAddress(entry),
      })),
    );
    const matchingApprover = resolvedApproverEntries.find((entry) => entry.resolvedAddress === address) ?? null;
    if (!matchingApprover) {
      return badRequest("Only tagged approvers can approve this freight", 403);
    }

    const existingApproval = giftDeliverable.approvals.find((approval) => normalizeAddress(approval.address) === address) ?? null;
    const nextApprovals: GiftApprovalRecord[] = existingApproval
      ? giftDeliverable.approvals
      : [
          ...giftDeliverable.approvals,
          {
            address,
            handle: matchingApprover.handle,
            approvedAt: new Date().toISOString(),
          },
        ];
    const requiredApprovalCount = deriveRequiredApprovalCount(giftDeliverable.approvers.length, giftDeliverable.approvalRule);
    const approvalsSatisfied = requiredApprovalCount !== null && nextApprovals.length >= requiredApprovalCount;
    const commencedAt = approvalsSatisfied
      ? (giftDeliverable.commencedAt ?? new Date().toISOString())
      : giftDeliverable.commencedAt ?? null;
    const nextGiftDeliverable = {
      ...giftDeliverable,
      approvals: nextApprovals,
      requiredApprovalCount,
      commencementState: approvalsSatisfied ? "commenced" : "pending_approval",
      commencedAt,
    };

    await collection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          giftDeliverable: nextGiftDeliverable,
          updatedAt: new Date(),
        },
      },
    );

    return NextResponse.json({
      ok: true,
      approvalCount: nextApprovals.length,
      requiredApprovalCount,
      approvalsSatisfied,
      commencementState: nextGiftDeliverable.commencementState,
      commencedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to approve gift freight";
    return badRequest(message);
  }
}
