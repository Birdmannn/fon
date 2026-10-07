import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";

import { getPublicCkbClient } from "@/lib/ckbClient";
import { awardFbarsEvent, computeRewardFbars, getCurrentWeekKey } from "@/lib/fbars";
import { getFbarEventsCollection, getMongoCollection, getUserProfilesCollection } from "@/lib/mongodb";
import { verifyRecurringRaffleCashout } from "@/lib/raffleWinProof";

export const dynamic = "force-dynamic";

type WinPayload = {
  address?: unknown;
  recordId?: unknown;
  txHash?: unknown;
};

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as WinPayload;
    const address = requiredString(payload.address, "address").toLowerCase();
    const recordId = requiredString(payload.recordId, "recordId");
    const txHash = requiredString(payload.txHash, "txHash").toLowerCase();
    if (!ObjectId.isValid(recordId) || !/^0x[0-9a-f]{64}$/.test(txHash)) {
      throw new Error("Invalid freight or transaction hash");
    }
    const record = await (await getMongoCollection()).findOne(
      { _id: new ObjectId(recordId) },
      { projection: { _id: 0, createdByHash: 1, chainCreatedAt: 1, campaignType: 1 } },
    );
    if (!record) return NextResponse.json({ error: "Freight not found" }, { status: 404 });

    const client = getPublicCkbClient();
    const confirmed = await client.waitTransaction(txHash, 0, 15_000);
    if (!confirmed || confirmed.status !== "committed") {
      return NextResponse.json({ error: "Cash-out transaction is not confirmed on chain" }, { status: 409 });
    }
    const award = await verifyRecurringRaffleCashout(client, confirmed.transaction, record, address);
    const eventsCollection = await getFbarEventsCollection();
    await eventsCollection.createIndex(
      { eventKey: 1 },
      { name: "unique_win_event_key", unique: true, partialFilterExpression: { kind: "win" } },
    );
    const result = await awardFbarsEvent({
      address: award.address,
      weekKey: getCurrentWeekKey(new Date()),
      eventKey: `win:${txHash}:${award.outputIndex}`,
      kind: "win",
      delta: computeRewardFbars(award.amountShannons),
      metadata: { recordId, txHash, amountShannons: award.amountShannons.toString() },
      profilesCollection: await getUserProfilesCollection(),
      eventsCollection,
    });
    return NextResponse.json({ ok: true, applied: result.applied, awardedFbars: computeRewardFbars(award.amountShannons) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to award win FBARS" }, { status: 400 });
  }
}
