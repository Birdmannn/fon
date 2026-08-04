import { NextResponse } from "next/server";

import {
  buildAddressRegex,
  formatUsernameHandle,
  normalizeAddress,
  resolveTargetAddress,
  toIsoDateTime,
} from "@/app/api/user-profiles/_lib/profileTarget";
import type { ProfileFreightInteractionKind, ProfileFreightRow } from "@/app/_types/profileTabs";
import { buildStableCampaignId, normalizeHash } from "@/lib/campaignIdentity";
import { getCampaignParticipantsCollection, getMongoCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

type CampaignRecordFreight = {
  _id?: unknown;
  title?: unknown;
  campaignId?: unknown;
  createdByHash?: unknown;
  chainCreatedAt?: unknown;
  campaignType?: unknown;
  creatorAddress?: unknown;
  creatorHandle?: unknown;
  createdAt?: unknown;
  settledAt?: unknown;
  updatedAt?: unknown;
  settledRecipients?: unknown;
  socialMetadata?: {
    comments?: unknown;
  };
};

type CampaignParticipantFreight = {
  campaignId?: unknown;
  createdByHash?: unknown;
  chainCreatedAt?: unknown;
  campaignType?: unknown;
  participantAddress?: unknown;
  joinedAt?: unknown;
  submittedAt?: unknown;
};

type FreightAggregate = {
  campaignId: string;
  campaignRecordId: string | null;
  creatorAddress: string | null;
  creatorHandle: string;
  interactionKinds: Set<ProfileFreightInteractionKind>;
  latestInteractionAt: string;
  strongestInteraction: ProfileFreightInteractionKind;
  title: string;
};

const INTERACTION_PRIORITY: Record<ProfileFreightInteractionKind, number> = {
  rewarded: 4,
  created: 3,
  participated: 2,
  commented: 1,
};

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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

function defaultTitle(record: CampaignRecordFreight) {
  return asString(record.title) || "Untitled freight";
}

function buildDefaultUsername(addressHex: string) {
  const normalized = addressHex.toLowerCase().replace(/^0x/, "");
  return `freight${normalized.slice(-20)}`;
}

function buildDefaultHandle(addressHex: string) {
  return formatUsernameHandle(buildDefaultUsername(addressHex));
}

function normalizeHandle(handle: string, address: string | null) {
  if (handle) {
    return handle.endsWith(".ckb") ? handle : formatUsernameHandle(handle);
  }

  return address ? buildDefaultHandle(address) : "freight.unknown.ckb";
}

function chooseStrongestInteraction(
  current: ProfileFreightInteractionKind,
  next: ProfileFreightInteractionKind
): ProfileFreightInteractionKind {
  return INTERACTION_PRIORITY[next] > INTERACTION_PRIORITY[current] ? next : current;
}

function upsertAggregate(
  aggregates: Map<string, FreightAggregate>,
  key: string,
  input: {
    campaignRecordId?: string | null;
    creatorAddress?: string | null;
    creatorHandle?: string;
    interaction: ProfileFreightInteractionKind;
    occurredAt: string;
    title?: string;
  }
) {
  const existing = aggregates.get(key);
  if (!existing) {
    aggregates.set(key, {
      campaignId: key,
      campaignRecordId: input.campaignRecordId ?? null,
      creatorAddress: input.creatorAddress ?? null,
      creatorHandle: normalizeHandle(input.creatorHandle ?? "", input.creatorAddress ?? null),
      interactionKinds: new Set([input.interaction]),
      latestInteractionAt: input.occurredAt,
      strongestInteraction: input.interaction,
      title: input.title?.trim() || "Untitled freight",
    });
    return;
  }

  existing.interactionKinds.add(input.interaction);
  if (input.campaignRecordId && !existing.campaignRecordId) {
    existing.campaignRecordId = input.campaignRecordId;
  }
  if (input.creatorAddress && !existing.creatorAddress) {
    existing.creatorAddress = input.creatorAddress;
  }
  if (input.creatorHandle && (!existing.creatorHandle || existing.creatorHandle === "freight.unknown.ckb")) {
    existing.creatorHandle = normalizeHandle(input.creatorHandle, input.creatorAddress ?? existing.creatorAddress);
  }
  if (input.title && existing.title === "Untitled freight") {
    existing.title = input.title;
  }
  if (input.occurredAt > existing.latestInteractionAt) {
    existing.latestInteractionAt = input.occurredAt;
  }
  existing.strongestInteraction = chooseStrongestInteraction(existing.strongestInteraction, input.interaction);
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
    const [campaignRecordsCollection, campaignParticipantsCollection] = await Promise.all([
      getMongoCollection(),
      getCampaignParticipantsCollection(),
    ]);

    const [createdRecords, rewardedRecords, commentRecords, participantRows] = await Promise.all([
      campaignRecordsCollection.find(
        { status: "published", creatorAddress: { $regex: targetAddressRegex } },
        {
          projection: {
            _id: 1,
            title: 1,
            campaignId: 1,
            createdByHash: 1,
            chainCreatedAt: 1,
            campaignType: 1,
            creatorAddress: 1,
            creatorHandle: 1,
            createdAt: 1,
          },
        }
      ).toArray() as Promise<CampaignRecordFreight[]>,
      campaignRecordsCollection.find(
        {
          status: "published",
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
            creatorAddress: 1,
            creatorHandle: 1,
            settledAt: 1,
            updatedAt: 1,
          },
        }
      ).toArray() as Promise<CampaignRecordFreight[]>,
      campaignRecordsCollection.find(
        {
          status: "published",
          "socialMetadata.comments": {
            $elemMatch: {
              creatorAddress: { $regex: targetAddressRegex },
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
            creatorAddress: 1,
            creatorHandle: 1,
            socialMetadata: 1,
          },
        }
      ).toArray() as Promise<CampaignRecordFreight[]>,
      campaignParticipantsCollection.find(
        { participantAddress: targetAddress },
        {
          projection: {
            _id: 0,
            campaignId: 1,
            createdByHash: 1,
            chainCreatedAt: 1,
            campaignType: 1,
            participantAddress: 1,
            joinedAt: 1,
            submittedAt: 1,
          },
        }
      ).toArray() as Promise<CampaignParticipantFreight[]>,
    ]);

    const aggregates = new Map<string, FreightAggregate>();

    createdRecords.forEach((record) => {
      const campaignId = deriveCampaignId(record);
      const occurredAt = toIsoDateTime(record.chainCreatedAt ?? record.createdAt);
      if (!campaignId || !occurredAt) {
        return;
      }

      upsertAggregate(aggregates, campaignId, {
        campaignRecordId: typeof record._id?.toString === "function" ? record._id.toString() : null,
        creatorAddress: asString(record.creatorAddress) || null,
        creatorHandle: asString(record.creatorHandle),
        interaction: "created",
        occurredAt,
        title: defaultTitle(record),
      });
    });

    participantRows.forEach((row) => {
      const campaignId = deriveCampaignId(row);
      const occurredAt = toIsoDateTime(row.joinedAt ?? row.submittedAt);
      if (!campaignId || !occurredAt) {
        return;
      }

      upsertAggregate(aggregates, campaignId, {
        interaction: "participated",
        occurredAt,
        title: "Untitled freight",
      });
    });

    rewardedRecords.forEach((record) => {
      const campaignId = deriveCampaignId(record);
      const occurredAt = toIsoDateTime(record.settledAt ?? record.updatedAt);
      if (!campaignId || !occurredAt) {
        return;
      }

      upsertAggregate(aggregates, campaignId, {
        campaignRecordId: typeof record._id?.toString === "function" ? record._id.toString() : null,
        creatorAddress: asString(record.creatorAddress) || null,
        creatorHandle: asString(record.creatorHandle),
        interaction: "rewarded",
        occurredAt,
        title: defaultTitle(record),
      });
    });

    commentRecords.forEach((record) => {
      const campaignId = deriveCampaignId(record);
      if (!campaignId || !Array.isArray(record.socialMetadata?.comments)) {
        return;
      }

      const matchingDates = record.socialMetadata.comments
        .filter((entry) => !!entry && typeof entry === "object")
        .map((entry) => entry as { creatorAddress?: unknown; createdAt?: unknown })
        .filter((entry) => typeof entry.creatorAddress === "string" && normalizeAddress(entry.creatorAddress) === targetAddress)
        .map((entry) => toIsoDateTime(entry.createdAt))
        .filter((value): value is string => Boolean(value));

      const occurredAt = matchingDates.sort().at(-1) ?? null;
      if (!occurredAt) {
        return;
      }

      upsertAggregate(aggregates, campaignId, {
        campaignRecordId: typeof record._id?.toString === "function" ? record._id.toString() : null,
        creatorAddress: asString(record.creatorAddress) || null,
        creatorHandle: asString(record.creatorHandle),
        interaction: "commented",
        occurredAt,
        title: defaultTitle(record),
      });
    });

    const rows: ProfileFreightRow[] = Array.from(aggregates.values())
      .sort((left, right) => right.latestInteractionAt.localeCompare(left.latestInteractionAt))
      .map((entry) => ({
        campaignId: entry.campaignId,
        campaignRecordId: entry.campaignRecordId,
        creatorAddress: entry.creatorAddress,
        creatorHandle: entry.creatorHandle,
        href: `/campaign/${encodeURIComponent(entry.campaignId)}`,
        interactionKinds: Array.from(entry.interactionKinds).sort(
          (left, right) => INTERACTION_PRIORITY[right] - INTERACTION_PRIORITY[left]
        ) as ProfileFreightInteractionKind[],
        latestInteractionAt: entry.latestInteractionAt,
        strongestInteraction: entry.strongestInteraction,
        title: entry.title,
      }));

    return NextResponse.json({ rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load profile freights";
    return badRequest(message, 500);
  }
}
