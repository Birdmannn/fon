import { NextResponse } from "next/server";

import {
  buildAddressRegex,
  resolveTargetAddress,
  toIsoDateTime,
} from "@/app/api/user-profiles/_lib/profileTarget";
import type { ProfileTransactionRow, ProfileTransactionsCoverage } from "@/app/_types/profileTabs";
import { buildStableCampaignId, normalizeHash } from "@/lib/campaignIdentity";
import { getAddressNetDeltaMap } from "@/lib/txBalanceDelta";
import {
  getCampaignDepositsCollection,
  getCampaignParticipantsCollection,
  getFbarEventsCollection,
  getMongoCollection,
} from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type CampaignRecordTransaction = {
  _id?: unknown;
  title?: unknown;
  campaignId?: unknown;
  createdByHash?: unknown;
  chainCreatedAt?: unknown;
  campaignType?: unknown;
  creatorAddress?: unknown;
  txHash?: unknown;
  activatedTxHash?: unknown;
  activatedAt?: unknown;
  activatedByAddress?: unknown;
  settlementTxHash?: unknown;
  settledAt?: unknown;
  settledByAddress?: unknown;
  settledRecipients?: unknown;
  updatedAt?: unknown;
};

type CampaignParticipantTransaction = {
  campaignId?: unknown;
  createdByHash?: unknown;
  chainCreatedAt?: unknown;
  campaignType?: unknown;
  participantAddress?: unknown;
  participantTxHash?: unknown;
  joinedAt?: unknown;
  submittedAt?: unknown;
};

type CampaignDepositTransaction = {
  amountShannons?: unknown;
  campaignId?: unknown;
  campaignRecordId?: unknown;
  depositedAt?: unknown;
  depositorAddress?: unknown;
  txHash?: unknown;
};

type FbarEventTransaction = {
  createdAt?: unknown;
  delta?: unknown;
  eventKey?: unknown;
  kind?: unknown;
  metadata?: unknown;
};

type Recipient = {
  address: string;
  amountLabel: string;
  amountShannons: string;
  creditedUsdCents?: number | null;
};

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function deriveCampaignId(record: {
  campaignId?: unknown;
  createdByHash?: unknown;
  chainCreatedAt?: unknown;
  campaignType?: unknown;
}) {
  const explicitCampaignId = normalizeHash(asString(record.campaignId));
  if (explicitCampaignId) {
    return explicitCampaignId;
  }

  return buildStableCampaignId(
    asString(record.createdByHash),
    asString(record.chainCreatedAt),
    asString(record.campaignType)
  );
}

function normalizeTitle(value: unknown) {
  return asString(value) || "Untitled freight";
}

function amountLabelFromShannons(amountShannons: string) {
  try {
    const value = BigInt(amountShannons);
    const sign = value < 0n ? "-" : "";
    const absolute = value < 0n ? -value : value;
    const whole = absolute / 100_000_000n;
    const decimals = (absolute % 100_000_000n).toString().padStart(8, "0").slice(0, 2);
    return `${sign}${whole.toString()}.${decimals} CKB`;
  } catch {
    return null;
  }
}

function parseRecipients(value: unknown): Recipient[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const candidate = entry as {
      address?: unknown;
      amountLabel?: unknown;
      amountShannons?: unknown;
      creditedUsdCents?: unknown;
    };

    if (
      typeof candidate.address !== "string"
      || typeof candidate.amountLabel !== "string"
      || typeof candidate.amountShannons !== "string"
    ) {
      return [];
    }

    return [{
      address: candidate.address.trim().toLowerCase(),
      amountLabel: candidate.amountLabel.trim(),
      amountShannons: candidate.amountShannons.trim(),
      creditedUsdCents: asPositiveInteger(candidate.creditedUsdCents),
    }];
  });
}

function buildRowId(parts: Array<string | null | undefined>) {
  return parts.map((part) => part ?? "").join(":");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const addressParam = url.searchParams.get("address")?.trim() ?? null;
    const handleParam = url.searchParams.get("handle")?.trim() ?? null;

    if (!addressParam && !handleParam) {
      return badRequest("address or handle is required");
    }

    const targetAddress = await resolveTargetAddress(addressParam, handleParam);
    if (!targetAddress) {
      return badRequest("User profile not found", 404);
    }

    const targetAddressRegex = buildAddressRegex(targetAddress);
    const [campaignRecordsCollection, campaignParticipantsCollection, campaignDepositsCollection, fbarEventsCollection] = await Promise.all([
      getMongoCollection(),
      getCampaignParticipantsCollection(),
      getCampaignDepositsCollection(),
      getFbarEventsCollection(),
    ]);

    const [createdRecords, activatedRecords, settlementRecords, rewardRecords, participantRows, depositRows, fbarEvents, legacyActivationCount] = await Promise.all([
      campaignRecordsCollection.find(
        {
          status: "published",
          creatorAddress: { $regex: targetAddressRegex },
          txHash: { $type: "string", $ne: "" },
        },
        {
          projection: {
            _id: 1,
            title: 1,
            campaignId: 1,
            createdByHash: 1,
            chainCreatedAt: 1,
            campaignType: 1,
            creatorAddress: 1,
            txHash: 1,
          },
        }
      ).toArray() as Promise<CampaignRecordTransaction[]>,
      campaignRecordsCollection.find(
        {
          status: "published",
          activatedByAddress: { $regex: targetAddressRegex },
          activatedTxHash: { $type: "string", $ne: "" },
        },
        {
          projection: {
            _id: 1,
            title: 1,
            campaignId: 1,
            createdByHash: 1,
            chainCreatedAt: 1,
            campaignType: 1,
            activatedAt: 1,
            activatedByAddress: 1,
            activatedTxHash: 1,
          },
        }
      ).toArray() as Promise<CampaignRecordTransaction[]>,
      campaignRecordsCollection.find(
        {
          status: "published",
          settledByAddress: { $regex: targetAddressRegex },
          settlementTxHash: { $type: "string", $ne: "" },
        },
        {
          projection: {
            _id: 1,
            title: 1,
            campaignId: 1,
            createdByHash: 1,
            chainCreatedAt: 1,
            campaignType: 1,
            settlementTxHash: 1,
            settledAt: 1,
            settledByAddress: 1,
          },
        }
      ).toArray() as Promise<CampaignRecordTransaction[]>,
      campaignRecordsCollection.find(
        {
          status: "published",
          settlementTxHash: { $type: "string", $ne: "" },
          settledRecipients: {
            $elemMatch: {
              address: { $regex: targetAddressRegex },
            },
          },
        },
        {
          projection: {
            _id: 1,
            title: 1,
            campaignId: 1,
            createdByHash: 1,
            chainCreatedAt: 1,
            campaignType: 1,
            settlementTxHash: 1,
            settledAt: 1,
            settledRecipients: 1,
          },
        }
      ).toArray() as Promise<CampaignRecordTransaction[]>,
      campaignParticipantsCollection.find(
        {
          participantAddress: targetAddress,
          participantTxHash: { $type: "string", $ne: "" },
        },
        {
          projection: {
            _id: 0,
            campaignId: 1,
            createdByHash: 1,
            chainCreatedAt: 1,
            campaignType: 1,
            participantTxHash: 1,
            joinedAt: 1,
            submittedAt: 1,
          },
        }
      ).toArray() as Promise<CampaignParticipantTransaction[]>,
      campaignDepositsCollection.find(
        {
          depositorAddress: targetAddress,
          txHash: { $type: "string", $ne: "" },
        },
        {
          projection: {
            _id: 0,
            amountShannons: 1,
            campaignId: 1,
            campaignRecordId: 1,
            depositedAt: 1,
            txHash: 1,
          },
        }
      ).toArray() as Promise<CampaignDepositTransaction[]>,
      fbarEventsCollection.find(
        {
          address: targetAddress,
          kind: { $in: ["wallet-seed", "freight-create", "deposit"] },
        },
        {
          projection: {
            _id: 0,
            createdAt: 1,
            delta: 1,
            eventKey: 1,
            kind: 1,
            metadata: 1,
          },
        }
      ).toArray() as Promise<FbarEventTransaction[]>,
      campaignRecordsCollection.countDocuments(
        {
          status: "published",
          creatorAddress: { $regex: targetAddressRegex },
          activatedTxHash: { $type: "string", $ne: "" },
          $or: [
            { activatedAt: { $exists: false } },
            { activatedAt: null },
            { activatedByAddress: { $exists: false } },
            { activatedByAddress: null },
          ],
        }
      ),
    ]);

    const referencedCampaignIds = Array.from(new Set([
      ...participantRows.map((row) => deriveCampaignId(row)).filter(Boolean),
      ...depositRows.map((row) => normalizeHash(asString(row.campaignId))).filter(Boolean),
    ]));

    const referencedRecords = referencedCampaignIds.length > 0
      ? await campaignRecordsCollection.find(
          {
            status: "published",
            campaignId: { $in: referencedCampaignIds },
          },
          {
            projection: {
              _id: 1,
              title: 1,
              campaignId: 1,
            },
          }
        ).toArray() as CampaignRecordTransaction[]
      : [];

    const recordByCampaignId = new Map<string, CampaignRecordTransaction>();
    const recordByTxHash = new Map<string, CampaignRecordTransaction>();
    [...createdRecords, ...activatedRecords, ...settlementRecords, ...rewardRecords, ...referencedRecords].forEach((record) => {
      const campaignId = deriveCampaignId(record);
      if (campaignId && !recordByCampaignId.has(campaignId)) {
        recordByCampaignId.set(campaignId, record);
      }
      const txHash = normalizeHash(asString(record.txHash));
      if (txHash && !recordByTxHash.has(txHash)) {
        recordByTxHash.set(txHash, record);
      }
    });

    const fbarByKindAndTxHash = new Map<string, FbarEventTransaction>();
    const walletSeedRows: ProfileTransactionRow[] = [];

    fbarEvents.forEach((event) => {
      const kind = asString(event.kind).toLowerCase();
      const occurredAt = toIsoDateTime(event.createdAt);
      if (!occurredAt) {
        return;
      }

      const delta = typeof event.delta === "number" && Number.isFinite(event.delta) ? event.delta : null;
      const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata as Record<string, unknown> : {};
      const txHash = normalizeHash(asString(metadata.txHash));

      if (kind === "wallet-seed") {
        const balanceShannons = asString(metadata.balanceShannons);
        walletSeedRows.push({
          adsfUsdCentsDelta: null,
          amountLabel: amountLabelFromShannons(balanceShannons),
          campaignId: null,
          campaignRecordId: null,
          campaignTitle: null,
          channel: "offchain",
          fbarsDelta: delta,
          id: buildRowId(["wallet-seed", asString(event.eventKey)]),
          kind: "wallet_seed",
          occurredAt,
          onchainNetDeltaShannons: null,
          role: "actor",
          summary: "Seeded wallet FBARS",
          txHash: null,
        });
        return;
      }

      if (txHash && (kind === "freight-create" || kind === "deposit")) {
        fbarByKindAndTxHash.set(`${kind}:${txHash}`, event);
      }
    });

    const txHashes = Array.from(new Set([
      ...createdRecords.map((record) => normalizeHash(asString(record.txHash))),
      ...activatedRecords.map((record) => normalizeHash(asString(record.activatedTxHash))),
      ...settlementRecords.map((record) => normalizeHash(asString(record.settlementTxHash))),
      ...rewardRecords.map((record) => normalizeHash(asString(record.settlementTxHash))),
      ...participantRows.map((row) => normalizeHash(asString(row.participantTxHash))),
      ...depositRows.map((row) => normalizeHash(asString(row.txHash))),
    ].filter(Boolean)));

    const deltaByTxHash = await getAddressNetDeltaMap(txHashes, targetAddress);
    const rows: ProfileTransactionRow[] = [...walletSeedRows];

    createdRecords.forEach((record) => {
      const txHash = normalizeHash(asString(record.txHash));
      const occurredAt = toIsoDateTime(record.chainCreatedAt);
      if (!txHash || !occurredAt) {
        return;
      }

      const fbarEvent = fbarByKindAndTxHash.get(`freight-create:${txHash}`);
      rows.push({
        adsfUsdCentsDelta: null,
        amountLabel: null,
        campaignId: deriveCampaignId(record),
        campaignRecordId: typeof record._id?.toString === "function" ? record._id.toString() : null,
        campaignTitle: normalizeTitle(record.title),
        channel: fbarEvent ? "hybrid" : "onchain",
        fbarsDelta: typeof fbarEvent?.delta === "number" ? fbarEvent.delta : null,
        id: buildRowId(["freight-create", txHash]),
        kind: "freight_create",
        occurredAt,
        onchainNetDeltaShannons: deltaByTxHash[txHash] ?? null,
        role: "actor",
        summary: "Created freight",
        txHash,
      });
    });

    activatedRecords.forEach((record) => {
      const txHash = normalizeHash(asString(record.activatedTxHash));
      const occurredAt = toIsoDateTime(record.activatedAt ?? record.updatedAt);
      if (!txHash || !occurredAt) {
        return;
      }

      rows.push({
        adsfUsdCentsDelta: null,
        amountLabel: null,
        campaignId: deriveCampaignId(record),
        campaignRecordId: typeof record._id?.toString === "function" ? record._id.toString() : null,
        campaignTitle: normalizeTitle(record.title),
        channel: "onchain",
        fbarsDelta: null,
        id: buildRowId(["campaign-activate", txHash]),
        kind: "campaign_activate",
        occurredAt,
        onchainNetDeltaShannons: deltaByTxHash[txHash] ?? null,
        role: "actor",
        summary: "Activated raffle",
        txHash,
      });
    });

    participantRows.forEach((row) => {
      const txHash = normalizeHash(asString(row.participantTxHash));
      const occurredAt = toIsoDateTime(row.joinedAt ?? row.submittedAt);
      const campaignId = deriveCampaignId(row);
      if (!txHash || !occurredAt || !campaignId) {
        return;
      }

      const record = recordByCampaignId.get(campaignId);
      rows.push({
        adsfUsdCentsDelta: null,
        amountLabel: null,
        campaignId,
        campaignRecordId: typeof record?._id?.toString === "function" ? record._id.toString() : null,
        campaignTitle: normalizeTitle(record?.title),
        channel: "onchain",
        fbarsDelta: null,
        id: buildRowId(["campaign-participation", txHash]),
        kind: "campaign_participation",
        occurredAt,
        onchainNetDeltaShannons: deltaByTxHash[txHash] ?? null,
        role: "actor",
        summary: "Joined freight",
        txHash,
      });
    });

    depositRows.forEach((row) => {
      const txHash = normalizeHash(asString(row.txHash));
      const occurredAt = toIsoDateTime(row.depositedAt);
      const campaignId = normalizeHash(asString(row.campaignId));
      if (!txHash || !occurredAt || !campaignId) {
        return;
      }

      const record = recordByCampaignId.get(campaignId);
      const fbarEvent = fbarByKindAndTxHash.get(`deposit:${txHash}`);
      const amountShannons = asString(row.amountShannons);
      rows.push({
        adsfUsdCentsDelta: null,
        amountLabel: amountLabelFromShannons(amountShannons),
        campaignId,
        campaignRecordId: asString(row.campaignRecordId) || (typeof record?._id?.toString === "function" ? record._id.toString() : null),
        campaignTitle: normalizeTitle(record?.title),
        channel: fbarEvent ? "hybrid" : "onchain",
        fbarsDelta: typeof fbarEvent?.delta === "number" ? fbarEvent.delta : null,
        id: buildRowId(["campaign-deposit", txHash]),
        kind: "campaign_deposit",
        occurredAt,
        onchainNetDeltaShannons: deltaByTxHash[txHash] ?? null,
        role: "actor",
        summary: "Deposited into freight",
        txHash,
      });
    });

    settlementRecords.forEach((record) => {
      const txHash = normalizeHash(asString(record.settlementTxHash));
      const occurredAt = toIsoDateTime(record.settledAt ?? record.updatedAt);
      if (!txHash || !occurredAt) {
        return;
      }

      rows.push({
        adsfUsdCentsDelta: null,
        amountLabel: null,
        campaignId: deriveCampaignId(record),
        campaignRecordId: typeof record._id?.toString === "function" ? record._id.toString() : null,
        campaignTitle: normalizeTitle(record.title),
        channel: "onchain",
        fbarsDelta: null,
        id: buildRowId(["campaign-settlement", txHash]),
        kind: "campaign_settlement",
        occurredAt,
        onchainNetDeltaShannons: deltaByTxHash[txHash] ?? null,
        role: "actor",
        summary: "Distributed raffle rewards",
        txHash,
      });
    });

    let hasMissingRewardCredits = false;
    rewardRecords.forEach((record) => {
      const txHash = normalizeHash(asString(record.settlementTxHash));
      const occurredAt = toIsoDateTime(record.settledAt ?? record.updatedAt);
      if (!txHash || !occurredAt) {
        return;
      }

      const matchingRecipients = parseRecipients(record.settledRecipients).filter((recipient) => recipient.address === targetAddress);
      if (matchingRecipients.length === 0) {
        return;
      }

      const amountShannons = matchingRecipients.reduce((sum, recipient) => sum + BigInt(recipient.amountShannons), 0n).toString();
      const adsfUsdCentsDelta = matchingRecipients.reduce((sum, recipient) => sum + (recipient.creditedUsdCents ?? 0), 0);
      if (matchingRecipients.some((recipient) => recipient.creditedUsdCents === null || recipient.creditedUsdCents === undefined)) {
        hasMissingRewardCredits = true;
      }

      rows.push({
        adsfUsdCentsDelta: adsfUsdCentsDelta > 0 ? adsfUsdCentsDelta : null,
        amountLabel: amountLabelFromShannons(amountShannons),
        campaignId: deriveCampaignId(record),
        campaignRecordId: typeof record._id?.toString === "function" ? record._id.toString() : null,
        campaignTitle: normalizeTitle(record.title),
        channel: "hybrid",
        fbarsDelta: null,
        id: buildRowId(["campaign-reward", txHash, targetAddress]),
        kind: "campaign_reward",
        occurredAt,
        onchainNetDeltaShannons: deltaByTxHash[txHash] ?? null,
        role: "recipient",
        summary: "Received raffle reward",
        txHash,
      });
    });

    const coverageNotes: string[] = [];
    if (legacyActivationCount > 0) {
      coverageNotes.push("Some older raffle activations may be missing because activation metadata was not always recorded.");
    }
    if (hasMissingRewardCredits) {
      coverageNotes.push("Some older reward rows may be missing ADSF deltas because recipient credit amounts were not yet persisted.");
    }

    const coverage: ProfileTransactionsCoverage = {
      complete: coverageNotes.length === 0,
      notes: coverageNotes,
    };

    rows.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

    return NextResponse.json({ coverage, rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load profile transactions";
    return badRequest(message, 500);
  }
}
