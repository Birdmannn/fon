import { NextResponse } from "next/server";
import { SignerSignType } from "@ckb-ccc/core";

import { verifyWalletSignature, walletActionNonceMatchesPurpose } from "@/lib/googleAuth";
import { verifyGoogleFormResponseAccess } from "@/lib/googleFormsApi";

export const dynamic = "force-dynamic";

type WalletSignaturePayload = {
  signature?: unknown;
  identity?: unknown;
  signType?: unknown;
};

type VerifyGoogleFormsAccessPayload = {
  address?: unknown;
  formId?: unknown;
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

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as VerifyGoogleFormsAccessPayload;
    const address = normalizeAddress(ensureString(payload.address, "address"));
    const formId = ensureString(payload.formId, "formId");
    const nonce = ensureString(payload.nonce, "nonce");
    const nonceSignature = parseVerifiedSignature(payload.nonceSignature);
    if (!walletActionNonceMatchesPurpose(nonce, "google-forms-access", address)) {
      throw new Error("Wallet nonce does not match Google Forms access verification");
    }

    await verifyWalletSignature({ address, nonce, signature: nonceSignature });

    const access = await verifyGoogleFormResponseAccess({
      address,
      formId,
    });

    return NextResponse.json({
      ok: true,
      access,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to verify Google Forms response access";
    return badRequest(message);
  }
}
