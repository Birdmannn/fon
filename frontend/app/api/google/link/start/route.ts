import { NextResponse } from "next/server";

import {
  buildGoogleAuthorizeUrl,
  buildGoogleOAuthCookieValue,
  createGoogleOAuthState,
  getGoogleOAuthCookieName,
  verifyWalletSignature,
} from "@/lib/googleAuth";
import { ccc } from "@ckb-ccc/connector-react";

export const dynamic = "force-dynamic";

type GoogleLinkStartPayload = {
  address?: unknown;
  nonce?: unknown;
  redirectPath?: unknown;
  signature?: {
    signature?: unknown;
    identity?: unknown;
    signType?: unknown;
  } | null;
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

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as GoogleLinkStartPayload;
    const address = ensureString(payload.address, "address");
    const nonce = ensureString(payload.nonce, "nonce");
    const signaturePayload = payload.signature;
    if (!signaturePayload || typeof signaturePayload !== "object") {
      throw new Error("signature is required");
    }

    const signature = ensureString(signaturePayload.signature, "signature.signature");
    const identity = ensureString(signaturePayload.identity, "signature.identity");
    const signTypeValue = ensureString(signaturePayload.signType, "signature.signType");
    if (!Object.values(ccc.SignerSignType).includes(signTypeValue as ccc.SignerSignType)) {
      throw new Error("Unsupported signer sign type");
    }

    await verifyWalletSignature({
      address,
      nonce,
      signature: {
        signature,
        identity,
        signType: signTypeValue as ccc.SignerSignType,
      },
    });

    const stateRecord = createGoogleOAuthState({
      address,
      nonce,
      redirectPath: typeof payload.redirectPath === "string" ? payload.redirectPath : "/",
    });

    const response = NextResponse.json({
      ok: true,
      authUrl: buildGoogleAuthorizeUrl(stateRecord.state),
    });
    response.cookies.set(getGoogleOAuthCookieName(), buildGoogleOAuthCookieValue(stateRecord.state), {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 10,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start Google link";
    return badRequest(message);
  }
}
