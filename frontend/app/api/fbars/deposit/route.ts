import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { SignerSignType } from "@ckb-ccc/core";

import { reconcileAdsfForAddress, shannonsToUsdCents } from "@/lib/adsf";
import { fetchCkbUsdPrice } from "@/lib/ckbPrice";
import {
  awardFbarsEvent,
  computeDepositFbars,
  getCurrentWeekKey,
  isWinningCampaignType,
} from "@/lib/fbars";
import { verifyWalletSignature } from "@/lib/googleAuth";
import { getPublicCkbClient } from "@/lib/ckbClient";
import { verifyCreatorTip } from "@/lib/creatorTipProof";
import { CampaignType } from "@/lib/contract";
import { getFbarEventsCollection, getMongoCollection, getUserProfilesCollection } from "@/lib/mongodb";

type WalletSignaturePayload = {
  signature?: unknown;
  identity?: unknown;
  signType?: unknown;
};

type DepositPayload = {
  address?: unknown;
  nonce?: unknown;
  nonceSignature?: WalletSignaturePayload | null;
  recordId?: unknown;
  txHash?: unknown;
  amountCkb?: unknown;
  amountShannons?: unknown;
  kind?: unknown;
  supportMode?: unknown;
};

type CampaignRecordShape = {
  creatorAddress?: unknown;
  campaignType?: unknown;
  campaignId?: unknown;
  createdByHash?: unknown;
  chainCreatedAt?: unknown;
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

function ensureFinitePositiveNumber(value: unknown, field: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive number`);
  }

  return parsed;
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

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as DepositPayload;
    const address = normalizeAddress(ensureString(payload.address, "address"));
    const isDirectTip = payload.supportMode === "direct_creator";
    if (!isDirectTip) {
      const nonce = ensureString(payload.nonce, "nonce");
      const nonceSignature = parseVerifiedSignature(payload.nonceSignature);
      await verifyWalletSignature({ expectedPurpose: "deposit", address, nonce, signature: nonceSignature });
    }

    const recordId = ensureString(payload.recordId, "recordId");
    if (!ObjectId.isValid(recordId)) {
      throw new Error("recordId must be a valid ObjectId");
    }

    const txHash = ensureString(payload.txHash, "txHash").toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(txHash)) return badRequest("Invalid transaction hash");
    const amountShannons = isDirectTip
      ? BigInt(ensureString(payload.amountShannons, "amountShannons"))
      : BigInt(Math.floor(ensureFinitePositiveNumber(payload.amountCkb, "amountCkb") * 100_000_000));
    if (amountShannons <= 0n) return badRequest("Support amount must be positive");
    const amountCkb = Number(amountShannons) / 100_000_000;
    const depositKind = isDirectTip ? "simple_task_tip" : typeof payload.kind === "string" && payload.kind.trim()
      ? payload.kind.trim()
      : "campaign_deposit";
    const supportMode = typeof payload.supportMode === "string" && payload.supportMode.trim()
      ? payload.supportMode.trim()
      : "campaign_escrow";

    const recordsCollection = await getMongoCollection();
    const record = await recordsCollection.findOne(
      { _id: new ObjectId(recordId) },
      {
        projection: {
          _id: 0,
          creatorAddress: 1,
          campaignType: 1,
          campaignId: 1,
          createdByHash: 1,
          chainCreatedAt: 1,
        },
      },
    ) as CampaignRecordShape | null;
    if (!record) {
      return badRequest("Campaign record not found", 404);
    }

    const creatorAddress = typeof record.creatorAddress === "string" ? normalizeAddress(record.creatorAddress) : "";
    const campaignType = typeof record.campaignType === "number" ? record.campaignType : Number(record.campaignType ?? 0);
    if (isDirectTip !== (campaignType === CampaignType.SimpleTask)) return badRequest("Support mode does not match this freight");
    const client = getPublicCkbClient();
    if (isDirectTip) {
      const confirmed = await verifyCreatorTip(client, txHash, address, {
        campaignId: typeof record.campaignId === "string" ? record.campaignId : null,
        createdByHash: typeof record.createdByHash === "string" ? record.createdByHash : null,
        chainCreatedAt: typeof record.chainCreatedAt === "string" ? record.chainCreatedAt : null,
        campaignType,
        creatorAddress,
      }, amountShannons);
      if (!confirmed) return badRequest("Tip transaction is not confirmed yet", 409);
    } else if (!await client.getTransaction(txHash)) {
      return badRequest("Deposit transaction not found on chain", 404);
    }

    const creatorEventKind = isWinningCampaignType(campaignType) ? "creator-winning-interaction" : "creator-non-winning-interaction";
    const depositFbars = computeDepositFbars(amountShannons);
    const tipUsdPerCkb = isDirectTip ? await fetchCkbUsdPrice({ allowStaleOnFailure: true }).catch(() => null) : null;
    const tipAdsfUsdCents = isDirectTip ? shannonsToUsdCents(amountShannons.toString(), tipUsdPerCkb) : null;
    const weekKey = getCurrentWeekKey(new Date());
    const [profilesCollection, eventsCollection] = await Promise.all([
      getUserProfilesCollection(),
      getFbarEventsCollection(),
    ]);
    if (isDirectTip) {
      await eventsCollection.createIndex(
        { eventKey: 1 },
        { name: "unique_direct_tip_event_key", unique: true, partialFilterExpression: { "metadata.supportMode": "direct_creator" } },
      );
    }

    const depositResult = await awardFbarsEvent({
      address,
      weekKey,
      eventKey: `deposit:${txHash}`,
      kind: "deposit",
      delta: depositFbars,
      metadata: {
        amountCkb,
        amountShannons: amountShannons.toString(),
        kind: depositKind,
        recordId,
        supportMode,
        txHash,
      },
      profilesCollection,
      eventsCollection,
    });

    const interactionResult = await awardFbarsEvent({
      address,
      weekKey,
      eventKey: `deposit-interaction:${txHash}`,
      kind: "interaction",
      delta: 0,
      metadata: {
        amountCkb,
        amountShannons: amountShannons.toString(),
        kind: depositKind,
        recordId,
        supportMode,
        txHash,
      },
      profilesCollection,
      eventsCollection,
    });

    let creatorApplied = false;
    if (creatorAddress) {
      const creatorResult = await awardFbarsEvent({
        address: creatorAddress,
        weekKey,
        eventKey: `creator-deposit-interaction:${txHash}`,
        kind: creatorEventKind,
        delta: 0,
        metadata: {
          actorAddress: address,
          amountCkb,
          amountShannons: amountShannons.toString(),
          kind: depositKind,
          recordId,
          supportMode,
          txHash,
          campaignType,
          ...(isDirectTip ? { adsfUsdCents: tipAdsfUsdCents } : {}),
        },
        profilesCollection,
        eventsCollection,
      });
      creatorApplied = creatorResult.applied;
      if (isDirectTip) {
        try {
          await reconcileAdsfForAddress(creatorAddress);
        } catch (error) {
          console.error("Failed to refresh creator ADSF after tip", error);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      txHash,
      amountCkb,
      depositFbars,
      depositApplied: depositResult.applied,
      interactionApplied: interactionResult.applied,
      creatorApplied,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to award deposit FBARS";
    return badRequest(message);
  }
}
