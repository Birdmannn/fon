import { NextResponse } from "next/server";

import {
  awardFbarsEvent,
  FREIGHT_CREATION_FBARS_COST,
  getCurrentWeekKey,
  type StoredFbarsProfile,
} from "@/lib/fbars";
import { getPublicCkbClient } from "@/lib/ckbClient";
import { verifyFreightCreateProof } from "@/lib/freightCreateProof";
import { getFbarEventsCollection, getUserProfilesCollection } from "@/lib/mongodb";

type FreightCreatePayload = {
  address?: unknown;
  txHash?: unknown;
  campaignId?: unknown;
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

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as FreightCreatePayload;
    const address = normalizeAddress(ensureString(payload.address, "address"));
    const txHash = ensureString(payload.txHash, "txHash").toLowerCase();
    const campaignId = ensureString(payload.campaignId, "campaignId").toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(txHash)) return badRequest("Invalid transaction hash");
    const confirmed = await verifyFreightCreateProof(getPublicCkbClient(), txHash, address, campaignId);
    if (!confirmed) return badRequest("Freight creation transaction is not confirmed yet", 409);

    const [profilesCollection, eventsCollection] = await Promise.all([
      getUserProfilesCollection(),
      getFbarEventsCollection(),
    ]);
    await eventsCollection.createIndex(
      { eventKey: 1 },
      { name: "unique_freight_create_event_key", unique: true, partialFilterExpression: { kind: "freight-create" } },
    );
    const existingEvent = await eventsCollection.findOne({ eventKey: `freight-create:${txHash}` }, { projection: { _id: 1 } });
    if (existingEvent) return NextResponse.json({ ok: true, applied: false, txHash, delta: -FREIGHT_CREATION_FBARS_COST });
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
        campaignId,
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
