import { fetchCkbUsdPrice } from "@/lib/ckbPrice";
import { buildAddressRegex } from "@/app/api/user-profiles/_lib/profileTarget";
import { getFbarEventsCollection, getMongoCollection, getUserProfilesCollection } from "@/lib/mongodb";
import type { ObjectId } from "mongodb";

type RewardRecord = { _id?: ObjectId; settlementTxHash?: unknown; settledRecipients?: unknown };
type TipEvent = { eventKey?: unknown; metadata?: unknown };

function asNonNegativeCents(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function shannonsToUsdCents(value: unknown, usdPerCkb: number | null) {
  if (usdPerCkb === null || typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const cents = Math.floor((Number(BigInt(value)) / 100_000_000) * usdPerCkb * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

export function calculateAdsfUsdCents(address: string, rewards: RewardRecord[], tips: TipEvent[], usdPerCkb: number | null) {
  let total = 0;
  let complete = true;
  const normalizedAddress = address.trim().toLowerCase();

  for (const record of rewards) {
    if (!Array.isArray(record.settledRecipients)) continue;
    for (const entry of record.settledRecipients) {
      if (!entry || typeof entry !== "object") continue;
      const recipient = entry as { address?: unknown; amountShannons?: unknown; creditedUsdCents?: unknown };
      if (typeof recipient.address !== "string" || recipient.address.trim().toLowerCase() !== normalizedAddress) continue;
      const cents = asNonNegativeCents(recipient.creditedUsdCents)
        ?? shannonsToUsdCents(recipient.amountShannons, usdPerCkb);
      if (cents === null) complete = false;
      else total += cents;
    }
  }

  for (const event of tips) {
    if (!event.metadata || typeof event.metadata !== "object") continue;
    const metadata = event.metadata as { amountShannons?: unknown; adsfUsdCents?: unknown };
    const cents = asNonNegativeCents(metadata.adsfUsdCents)
      ?? shannonsToUsdCents(metadata.amountShannons, usdPerCkb);
    if (cents === null) complete = false;
    else total += cents;
  }

  return { cents: total, complete: complete && Number.isSafeInteger(total) };
}

export async function reconcileAdsfForAddress(address: string) {
  const normalizedAddress = address.trim().toLowerCase();
  const addressRegex = buildAddressRegex(normalizedAddress);
  const [recordsCollection, eventsCollection, profilesCollection] = await Promise.all([
    getMongoCollection(), getFbarEventsCollection(), getUserProfilesCollection(),
  ]);
  const [rewards, tips] = await Promise.all([
    recordsCollection.find({
      settlementTxHash: { $type: "string", $ne: "" },
      settledRecipients: { $elemMatch: { address: { $regex: addressRegex } } },
    }, { projection: { _id: 1, settlementTxHash: 1, settledRecipients: 1 } }).toArray() as Promise<RewardRecord[]>,
    eventsCollection.find({
      address: normalizedAddress,
      kind: "creator-non-winning-interaction",
      "metadata.supportMode": "direct_creator",
    }, { projection: { _id: 0, eventKey: 1, metadata: 1 } }).toArray() as Promise<TipEvent[]>,
  ]);

  const hasMissingPrice = rewards.some((record) => Array.isArray(record.settledRecipients)
    && record.settledRecipients.some((entry: unknown) => entry && typeof entry === "object"
      && typeof (entry as { address?: unknown }).address === "string"
      && (entry as { address: string }).address.trim().toLowerCase() === normalizedAddress
      && asNonNegativeCents((entry as { creditedUsdCents?: unknown }).creditedUsdCents) === null))
    || tips.some((event) => asNonNegativeCents((event.metadata as { adsfUsdCents?: unknown } | null)?.adsfUsdCents) === null);
  const usdPerCkb = hasMissingPrice ? await fetchCkbUsdPrice({ allowStaleOnFailure: true }).catch(() => null) : null;
  if (usdPerCkb !== null) {
    await Promise.all(rewards.map(async (record) => {
      if (!record._id || !Array.isArray(record.settledRecipients)) return;
      let changed = false;
      const recipients = record.settledRecipients.map((entry: unknown) => {
        if (!entry || typeof entry !== "object") return entry;
        const recipient = entry as { address?: unknown; amountShannons?: unknown; creditedUsdCents?: unknown };
        if (typeof recipient.address !== "string" || recipient.address.trim().toLowerCase() !== normalizedAddress
          || asNonNegativeCents(recipient.creditedUsdCents) !== null) return entry;
        const cents = shannonsToUsdCents(recipient.amountShannons, usdPerCkb);
        if (cents === null) return entry;
        changed = true;
        return { ...recipient, creditedUsdCents: cents };
      });
      if (!changed) return;
      await recordsCollection.updateOne(
        { _id: record._id, settlementTxHash: record.settlementTxHash },
        { $set: { settledRecipients: recipients } },
      );
      record.settledRecipients = recipients;
    }));

    await Promise.all(tips.map(async (event) => {
      if (typeof event.eventKey !== "string" || !event.metadata || typeof event.metadata !== "object") return;
      const metadata = event.metadata as { amountShannons?: unknown; adsfUsdCents?: unknown };
      if (asNonNegativeCents(metadata.adsfUsdCents) !== null) return;
      const cents = shannonsToUsdCents(metadata.amountShannons, usdPerCkb);
      if (cents === null) return;
      await eventsCollection.updateOne({ eventKey: event.eventKey }, { $set: { "metadata.adsfUsdCents": cents } });
      metadata.adsfUsdCents = cents;
    }));
  }
  const result = calculateAdsfUsdCents(normalizedAddress, rewards, tips, usdPerCkb);
  if (result.complete) {
    await profilesCollection.updateOne({ address: normalizedAddress }, { $set: { adsfUsdCents: result.cents } });
  } else if (result.cents > 0) {
    await profilesCollection.updateOne({ address: normalizedAddress }, { $max: { adsfUsdCents: result.cents } });
  }
  return result;
}
