import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getMongoCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Lightweight endpoint to mark a campaign as activated on-chain.
// Called by the first ticket buyer after they successfully submit the
// update_campaign_status transaction. Sets activatedTxHash so subsequent
// buyers know the campaign is already Active on-chain and skip the step.
export async function POST(request: Request, context: RouteContext<"/api/campaign-records/[id]/activate">) {
  try {
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return badRequest("Invalid campaign record id", 404);
    }

    const body = (await request.json()) as {
      activatedAt?: unknown;
      activatedByAddress?: unknown;
      activatedTxHash?: unknown;
    };
    const activatedTxHash = body?.activatedTxHash;
    if (typeof activatedTxHash !== "string" || activatedTxHash.trim() === "") {
      return badRequest("activatedTxHash must be a non-empty string");
    }

    const activatedAt = typeof body?.activatedAt === "string" && body.activatedAt.trim()
      ? body.activatedAt.trim()
      : new Date().toISOString();
    const activatedByAddress = typeof body?.activatedByAddress === "string" && body.activatedByAddress.trim()
      ? body.activatedByAddress.trim().toLowerCase()
      : null;

    const collection = await getMongoCollection();
    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          activatedAt,
          activatedByAddress,
          activatedTxHash: activatedTxHash.trim(),
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return badRequest("Campaign record not found", 404);
    }

    return NextResponse.json({ ok: true, activatedAt, activatedTxHash: activatedTxHash.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to mark campaign as activated";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
