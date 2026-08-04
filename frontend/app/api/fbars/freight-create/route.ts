import { NextResponse } from "next/server";

import { SignerSignType } from "@ckb-ccc/core";

import {
  awardFbarsEvent,
  FREIGHT_CREATION_FBARS_COST,
  getCurrentWeekKey,
  type StoredFbarsProfile,
} from "@/lib/fbars";
import { verifyWalletSignature } from "@/lib/googleAuth";
import { getFbarEventsCollection, getUserProfilesCollection } from "@/lib/mongodb";

type WalletSignaturePayload = {
  signature?: unknown;
  identity?: unknown;
  signType?: unknown;
};

type FreightCreatePayload = {
  address?: unknown;
  nonce?: unknown;
  txHash?: unknown;
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

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as FreightCreatePayload;
    const address = normalizeAddress(ensureString(payload.address, "address"));
    const nonce = ensureString(payload.nonce, "nonce");
    const txHash = ensureString(payload.txHash, "txHash").toLowerCase();
    const nonceSignature = parseVerifiedSignature(payload.nonceSignature);
    await verifyWalletSignature({
      address,
      nonce,
      signature: nonceSignature,
    });

    const [profilesCollection, eventsCollection] = await Promise.all([
      getUserProfilesCollection(),
      getFbarEventsCollection(),
    ]);
    const currentProfile = await profilesCollection.findOne(
      { address },
      { projection: { _id: 0, address: 1, fbars: 1, weeklyFbarsState: 1 } },
    ) as StoredFbarsProfile | null;
    const currentFbars = typeof currentProfile?.fbars === "number"
      ? currentProfile.fbars
      : typeof currentProfile?.fbars === "string"
        ? Number(currentProfile.fbars)
        : 0;

    if (!Number.isFinite(currentFbars) || currentFbars < FREIGHT_CREATION_FBARS_COST) {
      return badRequest("At least 20 FBARS are required to create a freight", 403);
    }

    const result = await awardFbarsEvent({
      address,
      weekKey: getCurrentWeekKey(new Date()),
      eventKey: `freight-create:${txHash}`,
      kind: "freight-create",
      delta: -FREIGHT_CREATION_FBARS_COST,
      metadata: {
        txHash,
      },
      currentProfile,
      profilesCollection,
      eventsCollection,
    });

    return NextResponse.json({
      ok: true,
      applied: result.applied,
      txHash,
      delta: -FREIGHT_CREATION_FBARS_COST,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to apply freight creation FBARS cost";
    return badRequest(message);
  }
}
