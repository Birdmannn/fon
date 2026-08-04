import { NextResponse } from "next/server";

import { getCampaignDepositsCollection } from "@/lib/mongodb";

type CampaignDepositPayload = {
  amountShannons?: unknown;
  campaignId?: unknown;
  campaignRecordId?: unknown;
  depositedAt?: unknown;
  depositorAddress?: unknown;
  txHash?: unknown;
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

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as CampaignDepositPayload;
    const campaignId = ensureString(payload.campaignId, "campaignId").toLowerCase();
    const depositorAddress = ensureString(payload.depositorAddress, "depositorAddress").toLowerCase();
    const txHash = ensureString(payload.txHash, "txHash").toLowerCase();
    const amountShannons = ensureString(payload.amountShannons, "amountShannons");
    const campaignRecordId = typeof payload.campaignRecordId === "string" && payload.campaignRecordId.trim()
      ? payload.campaignRecordId.trim()
      : null;
    const depositedAt = typeof payload.depositedAt === "string" && payload.depositedAt.trim()
      ? payload.depositedAt.trim()
      : new Date().toISOString();

    const collection = await getCampaignDepositsCollection();
    await collection.updateOne(
      { txHash },
      {
        $set: {
          amountShannons,
          campaignId,
          campaignRecordId,
          depositedAt,
          depositorAddress,
          txHash,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    return NextResponse.json({ ok: true, txHash }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to store campaign deposit";
    return badRequest(message);
  }
}
