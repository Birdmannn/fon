import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { SignerSignType } from "@ckb-ccc/core";

import {
  awardFbarsEvent,
  computeDepositFbars,
  getCurrentWeekKey,
  isWinningCampaignType,
} from "@/lib/fbars";
import { verifyWalletSignature } from "@/lib/googleAuth";
import { getPublicCkbClient } from "@/lib/ckbClient";
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
};

type CampaignRecordShape = {
  creatorAddress?: unknown;
  campaignType?: unknown;
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
    const nonce = ensureString(payload.nonce, "nonce");
    const nonceSignature = parseVerifiedSignature(payload.nonceSignature);
    await verifyWalletSignature({ address, nonce, signature: nonceSignature });

    const recordId = ensureString(payload.recordId, "recordId");
    if (!ObjectId.isValid(recordId)) {
      throw new Error("recordId must be a valid ObjectId");
    }

    const txHash = ensureString(payload.txHash, "txHash").toLowerCase();
    const amountCkb = ensureFinitePositiveNumber(payload.amountCkb, "amountCkb");
    const amountShannons = BigInt(Math.floor(amountCkb * 100_000_000));

    const client = getPublicCkbClient();
    const tx = await client.getTransaction(txHash);
    if (!tx) {
      return badRequest("Deposit transaction not found on chain", 404);
    }

    const recordsCollection = await getMongoCollection();
    const record = await recordsCollection.findOne(
      { _id: new ObjectId(recordId) },
      {
        projection: {
          _id: 0,
          creatorAddress: 1,
          campaignType: 1,
        },
      },
    ) as CampaignRecordShape | null;
    if (!record) {
      return badRequest("Campaign record not found", 404);
    }

    const creatorAddress = typeof record.creatorAddress === "string" ? normalizeAddress(record.creatorAddress) : "";
    const campaignType = typeof record.campaignType === "number" ? record.campaignType : Number(record.campaignType ?? 0);
    const creatorEventKind = isWinningCampaignType(campaignType) ? "creator-winning-interaction" : "creator-non-winning-interaction";
    const depositFbars = computeDepositFbars(amountShannons);
    const weekKey = getCurrentWeekKey(new Date());
    const [profilesCollection, eventsCollection] = await Promise.all([
      getUserProfilesCollection(),
      getFbarEventsCollection(),
    ]);

    const depositResult = await awardFbarsEvent({
      address,
      weekKey,
      eventKey: `deposit:${txHash}`,
      kind: "deposit",
      delta: depositFbars,
      metadata: {
        amountCkb,
        amountShannons: amountShannons.toString(),
        recordId,
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
        recordId,
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
          recordId,
          txHash,
          campaignType,
        },
        profilesCollection,
        eventsCollection,
      });
      creatorApplied = creatorResult.applied;
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
