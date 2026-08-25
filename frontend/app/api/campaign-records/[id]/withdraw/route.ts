import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { SignerSignType } from "@ckb-ccc/core";

import { verifyWalletSignature, walletActionNonceMatchesPurpose } from "@/lib/googleAuth";
import { getMongoCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type WalletSignaturePayload = {
  signature?: unknown;
  identity?: unknown;
  signType?: unknown;
};

type CreatorWithdrawPayload = {
  address?: unknown;
  nonce?: unknown;
  nonceSignature?: WalletSignaturePayload | null;
  withdrawalTxHash?: unknown;
  withdrawnAt?: unknown;
  withdrawnAmountShannons?: unknown;
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

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return badRequest("Invalid campaign record id", 404);
    }

    const payload = (await request.json()) as CreatorWithdrawPayload;
    const address = normalizeAddress(ensureString(payload.address, "address"));
    const nonce = ensureString(payload.nonce, "nonce");
    const nonceSignature = parseVerifiedSignature(payload.nonceSignature);
    if (!walletActionNonceMatchesPurpose(nonce, "creator-withdraw", address)) {
      throw new Error("Wallet nonce does not match creator withdraw verification");
    }

    const withdrawalTxHash = ensureString(payload.withdrawalTxHash, "withdrawalTxHash");
    const withdrawnAmountShannons = ensureString(payload.withdrawnAmountShannons, "withdrawnAmountShannons");
    const withdrawnAt = typeof payload.withdrawnAt === "string" && payload.withdrawnAt.trim()
      ? payload.withdrawnAt.trim()
      : new Date().toISOString();

    await verifyWalletSignature({ address, nonce, signature: nonceSignature });

    const collection = await getMongoCollection();
    const existingRecord = await collection.findOne(
      { _id: new ObjectId(id) },
      { projection: { _id: 1, creatorAddress: 1 } },
    );
    if (!existingRecord) {
      return badRequest("Campaign record not found", 404);
    }

    const recordCreatorAddress = typeof existingRecord.creatorAddress === "string"
      ? normalizeAddress(existingRecord.creatorAddress)
      : "";
    if (!recordCreatorAddress) {
      return badRequest("Campaign record is missing a creator address", 409);
    }
    if (recordCreatorAddress !== address) {
      return badRequest("Only the freight creator can record this withdraw", 403);
    }

    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          withdrawalTxHash,
          withdrawnAt,
          withdrawnByAddress: address,
          withdrawnAmountShannons,
          updatedAt: new Date(),
        },
      },
    );

    if (result.matchedCount === 0) {
      return badRequest("Campaign record not found", 404);
    }

    return NextResponse.json({
      ok: true,
      withdrawalTxHash,
      withdrawnAt,
      withdrawnByAddress: address,
      withdrawnAmountShannons,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record creator withdraw";
    return badRequest(message);
  }
}
