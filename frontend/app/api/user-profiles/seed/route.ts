import { NextResponse } from "next/server";

import { Address, SignerSignType } from "@ckb-ccc/core";

import {
  awardFbarsEvent,
  computeWalletSeedFbars,
  getCurrentWeekKey,
  normalizeAddress,
  type StoredFbarsProfile,
} from "@/lib/fbars";
import { verifyWalletSignature } from "@/lib/googleAuth";
import { getUserProfilesCollection, getFbarEventsCollection } from "@/lib/mongodb";
import { getPublicCkbClient } from "@/lib/ckbClient";

type WalletSignaturePayload = {
  signature?: unknown;
  identity?: unknown;
  signType?: unknown;
};

type SeedPayload = {
  address?: unknown;
  nonce?: unknown;
  signature?: WalletSignaturePayload | null;
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

function parseVerifiedSignature(signaturePayload: unknown) {
  if (!signaturePayload || typeof signaturePayload !== "object") {
    throw new Error("signature is required");
  }

  const signature = ensureString((signaturePayload as WalletSignaturePayload).signature, "signature.signature");
  const identity = ensureString((signaturePayload as WalletSignaturePayload).identity, "signature.identity");
  const signTypeValue = ensureString((signaturePayload as WalletSignaturePayload).signType, "signature.signType");
  if (!Object.values(SignerSignType).includes(signTypeValue as SignerSignType)) {
    throw new Error("Unsupported signer sign type");
  }

  return {
    signature,
    identity,
    signType: signTypeValue as SignerSignType,
  };
}

async function getWalletBalanceShannons(address: string) {
  const client = getPublicCkbClient();
  const addressObj = await Address.fromString(address, client);
  return client.getBalance([addressObj.script]);
}

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as SeedPayload;
    const address = normalizeAddress(ensureString(payload.address, "address"));
    const nonce = ensureString(payload.nonce, "nonce");
    const signature = parseVerifiedSignature(payload.signature);
    await verifyWalletSignature({ address, nonce, signature });

    const [profilesCollection, eventsCollection] = await Promise.all([
      getUserProfilesCollection(),
      getFbarEventsCollection(),
    ]);
    const currentProfile = await profilesCollection.findOne(
      { address },
      {
        projection: {
          _id: 0,
          address: 1,
          fbars: 1,
          weeklyFbarsState: 1,
          walletFbarsSeededAt: 1,
          walletFbarsSeedBalanceShannons: 1,
        },
      },
    ) as StoredFbarsProfile | null;

    if (typeof currentProfile?.walletFbarsSeededAt === "string" && currentProfile.walletFbarsSeededAt.trim().length > 0) {
      return NextResponse.json({ ok: true, alreadySeeded: true });
    }

    const balanceShannons = await getWalletBalanceShannons(address);
    const awardedFbars = computeWalletSeedFbars(balanceShannons);
    const now = new Date();
    const weekKey = getCurrentWeekKey(now);
    const eventKey = `wallet-seed:${address}`;

    const result = await awardFbarsEvent({
      address,
      weekKey,
      eventKey,
      kind: "wallet-seed",
      delta: awardedFbars,
      metadata: {
        balanceShannons: balanceShannons.toString(),
      },
      currentProfile,
      profilesCollection,
      eventsCollection,
    });

    await profilesCollection.updateOne(
      { address },
      {
        $set: {
          walletFbarsSeededAt: now.toISOString(),
          walletFbarsSeedBalanceShannons: balanceShannons.toString(),
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true },
    );

    return NextResponse.json({
      ok: true,
      alreadySeeded: !result.applied,
      awardedFbars,
      balanceShannons: balanceShannons.toString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to seed wallet FBARS";
    return badRequest(message);
  }
}
