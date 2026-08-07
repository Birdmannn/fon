import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { SignerSignType } from "@ckb-ccc/core";

import { normalizeFormsMountableConfig } from "@/app/_lib/formsMountable";
import { findGoogleFormResponseByEmail } from "@/lib/googleFormsApi";
import { verifyWalletSignature, walletActionNonceMatchesPurpose } from "@/lib/googleAuth";
import { getCampaignParticipantsCollection, getMongoCollection, getUserProfilesCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type WalletSignaturePayload = {
  signature?: unknown;
  identity?: unknown;
  signType?: unknown;
};

type ClaimFormsPayload = {
  address?: unknown;
  nonce?: unknown;
  nonceSignature?: WalletSignaturePayload | null;
};

type LinkedGoogleAccountDocument = {
  sub?: unknown;
  email?: unknown;
  emailVerified?: unknown;
};

type ExistingFormsClaim = {
  status?: unknown;
  responseId?: unknown;
  responseCreateTime?: unknown;
  responseLastSubmittedTime?: unknown;
  matchedRespondentEmail?: unknown;
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

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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

function parseLinkedGoogleAccount(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as LinkedGoogleAccountDocument;
  if (typeof candidate.sub !== "string" || typeof candidate.email !== "string") {
    return null;
  }

  return {
    sub: candidate.sub.trim(),
    email: candidate.email.trim().toLowerCase(),
    emailVerified: candidate.emailVerified === true,
  };
}

function resolveClaimStatus(existingStatus: string | null, hasMatch: boolean) {
  if (existingStatus === "rejected") {
    return "rejected" as const;
  }

  if (existingStatus === "verified" || hasMatch) {
    return "verified" as const;
  }

  return "pending" as const;
}

export async function POST(request: Request, context: RouteContext<"/api/campaign-records/[id]/forms/claim">) {
  try {
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return badRequest("Invalid campaign record id", 404);
    }

    const payload = (await request.json()) as ClaimFormsPayload;
    const address = normalizeAddress(ensureString(payload.address, "address"));
    const nonce = ensureString(payload.nonce, "nonce");
    const nonceSignature = parseVerifiedSignature(payload.nonceSignature);
    if (!walletActionNonceMatchesPurpose(nonce, "forms-claim", address)) {
      throw new Error("Wallet nonce does not match forms claim verification");
    }

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
          creatorAddress: 1,
          mountables: 1,
        },
      },
    );

    if (!record) {
      return badRequest("Campaign record not found", 404);
    }

    const formsMountable = normalizeFormsMountableConfig(record.mountables?.forms ?? null);
    if (!formsMountable.enabled) {
      return badRequest("Forms verification is not enabled for this freight", 409);
    }

    if (!formsMountable.formId) {
      return badRequest("Mounted form is missing a Google Form id", 409);
    }

    const creatorAddress = normalizeOptionalString(record.creatorAddress)?.toLowerCase() ?? null;
    if (!creatorAddress) {
      return badRequest("This freight is missing a creator address for Google Forms verification", 409);
    }

    const userProfilesCollection = await getUserProfilesCollection();
    const profile = await userProfilesCollection.findOne(
      { address },
      {
        projection: {
          _id: 0,
          googleAccount: 1,
        },
      },
    );

    const linkedGoogleAccount = parseLinkedGoogleAccount(profile?.googleAccount ?? null);
    if (!linkedGoogleAccount?.email || !linkedGoogleAccount.emailVerified) {
      return badRequest("Link a verified Google account before verifying this form", 409);
    }

    const participantsCollection = await getCampaignParticipantsCollection();
    const campaignId = typeof record.campaignId === "string" ? record.campaignId.trim().toLowerCase() : "";
    if (!campaignId) {
      return badRequest("Campaign record is missing a stable campaign id", 409);
    }

    const claimQuery = {
      campaignId,
      googleSub: linkedGoogleAccount.sub,
      mountableType: "forms",
      participantKind: "forms_claim",
    };
    const existingClaim = await participantsCollection.findOne(claimQuery, {
      projection: {
        status: 1,
        responseId: 1,
        responseCreateTime: 1,
        responseLastSubmittedTime: 1,
        matchedRespondentEmail: 1,
      },
    }) as ExistingFormsClaim | null;

    const responseMatch = await findGoogleFormResponseByEmail({
      creatorAddress,
      formId: formsMountable.formId,
      participantEmail: linkedGoogleAccount.email,
    });

    const status = resolveClaimStatus(normalizeOptionalString(existingClaim?.status)?.toLowerCase() ?? null, Boolean(responseMatch));
    const now = new Date();
    const nowIso = now.toISOString();

    await participantsCollection.updateOne(
      claimQuery,
      {
        $set: {
          campaignId,
          createdByHash: typeof record.createdByHash === "string" ? record.createdByHash.trim().toLowerCase() : "",
          chainCreatedAt: typeof record.chainCreatedAt === "string" ? record.chainCreatedAt : "",
          campaignType: typeof record.campaignType === "number" ? record.campaignType : Number(record.campaignType ?? 0),
          participantAddress: address,
          participantTxHash: null,
          status,
          participantKind: "forms_claim",
          mountableType: "forms",
          verificationProvider: "google_forms_api",
          googleSub: linkedGoogleAccount.sub,
          googleEmail: linkedGoogleAccount.email,
          googleEmailVerified: true,
          submittedAt: nowIso,
          matchedRespondentEmail: responseMatch?.respondentEmail ?? normalizeOptionalString(existingClaim?.matchedRespondentEmail),
          responseId: responseMatch?.responseId ?? normalizeOptionalString(existingClaim?.responseId),
          responseCreateTime: responseMatch?.createTime ?? normalizeOptionalString(existingClaim?.responseCreateTime),
          responseLastSubmittedTime: responseMatch?.lastSubmittedTime ?? normalizeOptionalString(existingClaim?.responseLastSubmittedTime),
          lastVerifiedAt: nowIso,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
          joinedAt: nowIso,
        },
      },
      { upsert: true },
    );

    return NextResponse.json({
      ok: true,
      status,
      matchFound: Boolean(responseMatch),
      googleEmail: linkedGoogleAccount.email,
      responseId: responseMatch?.responseId ?? normalizeOptionalString(existingClaim?.responseId),
      responseLastSubmittedTime: responseMatch?.lastSubmittedTime ?? normalizeOptionalString(existingClaim?.responseLastSubmittedTime),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to verify forms claim";
    return badRequest(message);
  }
}
