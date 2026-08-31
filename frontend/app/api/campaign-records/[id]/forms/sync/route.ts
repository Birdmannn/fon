import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { SignerSignType } from "@ckb-ccc/core";

import { normalizeFormsMountableConfig } from "@/app/_lib/formsMountable";
import { findGoogleFormResponseByEmail } from "@/lib/googleFormsApi";
import { dispatchMountedAppRequestsForParticipant, finalizeCampaignParticipant, type CampaignRecordMountableRuntime } from "@/lib/mountableAppRuntime";
import { verifyWalletSignature, walletActionNonceMatchesPurpose } from "@/lib/googleAuth";
import { getCampaignParticipantsCollection, getMongoCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type WalletSignaturePayload = {
  signature?: unknown;
  identity?: unknown;
  signType?: unknown;
};

type SyncFormsClaimsPayload = {
  address?: unknown;
  nonce?: unknown;
  nonceSignature?: WalletSignaturePayload | null;
};

type PendingFormsClaim = {
  _id: ObjectId;
  googleEmail?: unknown;
  status?: unknown;
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

export async function POST(request: Request, context: RouteContext<"/api/campaign-records/[id]/forms/sync">) {
  try {
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return badRequest("Invalid campaign record id", 404);
    }

    const payload = (await request.json()) as SyncFormsClaimsPayload;
    const address = normalizeAddress(ensureString(payload.address, "address"));
    const nonce = ensureString(payload.nonce, "nonce");
    const nonceSignature = parseVerifiedSignature(payload.nonceSignature);
    if (!walletActionNonceMatchesPurpose(nonce, "forms-sync", address)) {
      throw new Error("Wallet nonce does not match forms sync verification");
    }

    await verifyWalletSignature({ address, nonce, signature: nonceSignature });

    const recordCollection = await getMongoCollection();
    const record = await recordCollection.findOne(
      { _id: new ObjectId(id) },
      {
        projection: {
          campaignId: 1,
          creatorAddress: 1,
          mountables: 1,
        },
      },
    ) as ({ creatorAddress?: unknown } & CampaignRecordMountableRuntime) | null;

    if (!record) {
      return badRequest("Campaign record not found", 404);
    }

    const creatorAddress = typeof record.creatorAddress === "string" ? record.creatorAddress.trim().toLowerCase() : "";
    if (!creatorAddress || creatorAddress !== address) {
      return badRequest("Only the campaign creator can sync forms claims", 403);
    }

    const formsMountable = normalizeFormsMountableConfig(record.mountables?.forms ?? null);
    if (!formsMountable.enabled || !formsMountable.formId) {
      return badRequest("Forms verification is not enabled for this freight", 409);
    }

    const campaignId = typeof record.campaignId === "string" ? record.campaignId.trim().toLowerCase() : "";
    if (!campaignId) {
      return badRequest("Campaign record is missing a stable campaign id", 409);
    }

    const participantsCollection = await getCampaignParticipantsCollection();
    const pendingClaims = await participantsCollection.find(
      {
        campaignId,
        mountableType: "forms",
        participantKind: "forms_claim",
        status: "pending",
      },
      {
        projection: {
          _id: 1,
          googleEmail: 1,
          status: 1,
        },
      },
    ).toArray() as PendingFormsClaim[];

    let verifiedCount = 0;
    const finalizedParticipants: Array<{ participantAddress: string; canonicalVerification: Awaited<ReturnType<typeof finalizeCampaignParticipant>> }> = [];
    for (const claim of pendingClaims) {
      const participantEmail = typeof claim.googleEmail === "string" ? claim.googleEmail.trim().toLowerCase() : "";
      if (!participantEmail) {
        continue;
      }

      const responseMatch = await findGoogleFormResponseByEmail({
        creatorAddress,
        formId: formsMountable.formId,
        participantEmail,
      });
      if (!responseMatch) {
        continue;
      }

      verifiedCount += 1;
      const verifiedAt = new Date().toISOString();
      await participantsCollection.updateOne(
        { _id: claim._id },
        {
          $set: {
            status: "verified",
            matchedRespondentEmail: responseMatch.respondentEmail,
            responseId: responseMatch.responseId,
            responseCreateTime: responseMatch.createTime,
            responseLastSubmittedTime: responseMatch.lastSubmittedTime,
            lastVerifiedAt: verifiedAt,
            updatedAt: new Date(),
          },
        },
      );
      const refreshedClaim = await participantsCollection.findOne(
        { _id: claim._id },
        { projection: { _id: 0, participantAddress: 1 } },
      ) as { participantAddress?: unknown } | null;
      const participantAddress = typeof refreshedClaim?.participantAddress === "string" ? refreshedClaim.participantAddress.trim().toLowerCase() : "";
      if (participantAddress) {
        const canonicalVerification = await finalizeCampaignParticipant({ campaignId, participantAddress, record });
        finalizedParticipants.push({ participantAddress, canonicalVerification });
      }
    }

    await Promise.all(
      finalizedParticipants.map(({ participantAddress, canonicalVerification }) => dispatchMountedAppRequestsForParticipant({
        campaignId,
        participantAddress,
        record,
        canonicalVerification,
        source: "forms-sync",
      })),
    );

    return NextResponse.json({
      ok: true,
      checkedCount: pendingClaims.length,
      verifiedCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync forms claims";
    return badRequest(message);
  }
}
