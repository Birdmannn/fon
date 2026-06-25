import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";

import { getMongoCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function ensureOptionalRecipients(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new Error("settledRecipients must be an array when provided");
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`settledRecipients[${index}] must be an object`);
    }

    const candidate = entry as {
      address?: unknown;
      username?: unknown;
      handle?: unknown;
    };

    if (typeof candidate.address !== "string" || typeof candidate.username !== "string" || typeof candidate.handle !== "string") {
      throw new Error(`settledRecipients[${index}] must include string address, username, and handle`);
    }

    return {
      address: candidate.address.trim(),
      username: candidate.username.trim(),
      handle: candidate.handle.trim(),
    };
  });
}

export async function POST(request: Request, context: RouteContext<"/api/campaign-records/[id]/settle">) {
  try {
    const { id } = await context.params;
    if (!ObjectId.isValid(id)) {
      return badRequest("Invalid campaign record id", 404);
    }

    const body = (await request.json()) as {
      settlementTxHash?: unknown;
      settledAt?: unknown;
      soldTicketCount?: unknown;
      settledParticipantCount?: unknown;
      settledRecipients?: unknown;
    };
    const settlementTxHash = body?.settlementTxHash;
    if (typeof settlementTxHash !== "string" || settlementTxHash.trim() === "") {
      return badRequest("settlementTxHash must be a non-empty string");
    }

    const settledAt = typeof body?.settledAt === "string" && body.settledAt.trim()
      ? body.settledAt.trim()
      : new Date().toISOString();
    const soldTicketCount = typeof body?.soldTicketCount === "string" && body.soldTicketCount.trim()
      ? body.soldTicketCount.trim()
      : null;
    const settledParticipantCount = typeof body?.settledParticipantCount === "string" && body.settledParticipantCount.trim()
      ? body.settledParticipantCount.trim()
      : null;
    const settledRecipients = ensureOptionalRecipients(body?.settledRecipients);

    const collection = await getMongoCollection();
    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          settlementTxHash: settlementTxHash.trim(),
          settledAt,
          soldTicketCount,
          settledParticipantCount,
          settledRecipients,
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
