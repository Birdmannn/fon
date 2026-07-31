import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";

import { fetchCkbUsdPrice } from "@/lib/ckbPrice";
import { getMongoCollection, getUserProfilesCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

function convertShannonsToUsdCents(amountShannons: bigint, usdPerCkb: number) {
  return Math.max(0, Math.floor((Number(amountShannons) / 1e8) * usdPerCkb * 100));
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
      amountLabel?: unknown;
      amountShannons?: unknown;
    };

    if (
      typeof candidate.address !== "string"
      || typeof candidate.username !== "string"
      || typeof candidate.handle !== "string"
      || typeof candidate.amountLabel !== "string"
      || typeof candidate.amountShannons !== "string"
    ) {
      throw new Error(`settledRecipients[${index}] must include string address, username, handle, amountLabel, and amountShannons`);
    }

    return {
      address: candidate.address.trim(),
      username: candidate.username.trim(),
      handle: candidate.handle.trim(),
      amountLabel: candidate.amountLabel.trim(),
      amountShannons: candidate.amountShannons.trim(),
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
    const existingRecord = await collection.findOne(
      { _id: new ObjectId(id) },
      { projection: { _id: 1, settlementTxHash: 1 } },
    );
    if (!existingRecord) {
      return badRequest("Campaign record not found", 404);
    }

    const settlementCreditKey = `${id}:${settlementTxHash.trim().toLowerCase()}`;
    let usdPerCkb: number | null = null;
    if (settledRecipients && settledRecipients.length > 0) {
      try {
        usdPerCkb = await fetchCkbUsdPrice({ allowStaleOnFailure: true });
      } catch {
        usdPerCkb = null;
      }
    }

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

    if (usdPerCkb !== null && settledRecipients && settledRecipients.length > 0) {
      const userProfilesCollection = await getUserProfilesCollection();
      const recipientTotals = new Map<string, number>();
      const creditMarkers = new Map<string, string>();

      for (const recipient of settledRecipients) {
        const normalizedAddress = normalizeAddress(recipient.address);
        if (!normalizedAddress) {
          continue;
        }

        const amountShannons = BigInt(recipient.amountShannons);
        const amountUsdCents = convertShannonsToUsdCents(amountShannons, usdPerCkb);
        recipientTotals.set(normalizedAddress, (recipientTotals.get(normalizedAddress) ?? 0) + amountUsdCents);
        creditMarkers.set(normalizedAddress, `adsfSettlementCredits.${settlementCreditKey}`);
      }

      await Promise.all(
        Array.from(recipientTotals.entries()).map(async ([address, amountUsdCents]) => {
          if (amountUsdCents <= 0) {
            return;
          }

          const defaultUsername = `freight${address.replace(/^0x/, "").slice(-20)}`;
          const creditField = creditMarkers.get(address);
          if (!creditField) {
            return;
          }

          const alreadyCredited = await userProfilesCollection.findOne(
            {
              address,
              [creditField]: { $exists: true },
            },
            { projection: { _id: 1 } },
          );
          if (alreadyCredited) {
            return;
          }

          await userProfilesCollection.updateOne(
            { address },
            {
              $inc: { adsfUsdCents: amountUsdCents },
              $set: {
                address,
                updatedAt: new Date(),
                lastSeenAt: new Date(),
                [creditField]: new Date().toISOString(),
              },
              $setOnInsert: {
                username: defaultUsername,
                displayName: defaultUsername,
                fbars: 0,
                createdAt: new Date(),
              },
            },
            { upsert: true }
          );
        })
      );
    }

    return NextResponse.json({ ok: true, settledAt, settlementTxHash: settlementTxHash.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to mark campaign as settled";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
