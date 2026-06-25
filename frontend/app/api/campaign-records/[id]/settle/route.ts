import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";

import { getMongoCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request, context: RouteContext<"/api/campaign-records/[id]/settle">) {
  try {
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return badRequest("Invalid campaign record id", 404);
    }

    const body = (await request.json()) as { settlementTxHash?: unknown; settledAt?: unknown };
    const settlementTxHash = body?.settlementTxHash;
    if (typeof settlementTxHash !== "string" || settlementTxHash.trim() === "") {
      return badRequest("settlementTxHash must be a non-empty string");
    }

    const settledAt = typeof body?.settledAt === "string" && body.settledAt.trim()
      ? body.settledAt.trim()
      : new Date().toISOString();

    const collection = await getMongoCollection();
    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          settlementTxHash: settlementTxHash.trim(),
          settledAt,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return badRequest("Campaign record not found", 404);
    }

    return NextResponse.json({ ok: true, settledAt, settlementTxHash: settlementTxHash.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to mark campaign as settled";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
