import { NextResponse } from "next/server";

import { getCampaignParticipantsCollection, getMongoCollection, getUserProfilesCollection } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

const ANALYTICS_RANGE_DAYS = 90;

type StoredProfileRecord = {
  address?: unknown;
  username?: unknown;
};

type CampaignRecordAnalytics = {
  creatorAddress?: unknown;
  status?: unknown;
  chainCreatedAt?: unknown;
  createdAt?: unknown;
  settledAt?: unknown;
  updatedAt?: unknown;
  settledRecipients?: unknown;
};

type CampaignParticipantAnalytics = {
  participantAddress?: unknown;
  joinedAt?: unknown;
  submittedAt?: unknown;
};

type AnalyticsPoint = {
  date: string;
  produced: number;
  participated: number;
  rewarded: number;
};

function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

function normalizeUsername(value: string) {
  return value.trim().replace(/\.ckb$/i, "").toLowerCase();
}

function formatUsernameHandle(username: string) {
  const normalized = username.trim().replace(/\.ckb$/i, "");
  return normalized ? `${normalized}.ckb` : "";
}

function parseDateValue(value: unknown) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const normalizedValue = value < 1e11 ? value * 1000 : value;
    const nextDate = new Date(normalizedValue);
    return Number.isNaN(nextDate.getTime()) ? null : nextDate;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (/^\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        return null;
      }

      const normalizedValue = trimmed.length <= 10 ? parsed * 1000 : parsed;
      const nextDate = new Date(normalizedValue);
      return Number.isNaN(nextDate.getTime()) ? null : nextDate;
    }

    const parsed = Date.parse(trimmed);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    const nextDate = new Date(parsed);
    return Number.isNaN(nextDate.getTime()) ? null : nextDate;
  }

  return null;
}

function toUtcDayKey(value: unknown) {
  const parsedDate = parseDateValue(value);
  return parsedDate ? parsedDate.toISOString().slice(0, 10) : null;
}

function buildDayRange(days: number) {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - days + 1);

  const points: AnalyticsPoint[] = [];
  for (let index = 0; index < days; index += 1) {
    const nextDate = new Date(start);
    nextDate.setUTCDate(start.getUTCDate() + index);
    points.push({
      date: nextDate.toISOString().slice(0, 10),
      produced: 0,
      participated: 0,
      rewarded: 0,
    });
  }

  return {
    startDate: points[0]?.date ?? end.toISOString().slice(0, 10),
    endDate: points[points.length - 1]?.date ?? end.toISOString().slice(0, 10),
    points,
  };
}

function buildAddressRegex(address: string) {
  const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`, "i");
}

function bucketEvent(
  pointsByDate: Map<string, AnalyticsPoint>,
  value: unknown,
  field: keyof Omit<AnalyticsPoint, "date">,
  amount = 1,
) {
  const dayKey = toUtcDayKey(value);
  if (!dayKey || amount <= 0) {
    return;
  }

  const point = pointsByDate.get(dayKey);
  if (!point) {
    return;
  }

  point[field] += amount;
}

function countMatchingRecipients(value: unknown, targetAddress: string) {
  if (!Array.isArray(value)) {
    return 0;
  }

  return value.reduce((count, entry) => {
    if (!entry || typeof entry !== "object") {
      return count;
    }

    const candidate = entry as { address?: unknown };
    if (typeof candidate.address !== "string") {
      return count;
    }

    return normalizeAddress(candidate.address) === targetAddress ? count + 1 : count;
  }, 0);
}

async function resolveTargetAddress(addressParam: string | null | undefined, handleParam: string | null | undefined) {
  if (addressParam) {
    return normalizeAddress(addressParam);
  }

  if (!handleParam) {
    return null;
  }

  const collection = await getUserProfilesCollection();
  const profiles = (await collection.find({}, { projection: { _id: 0, address: 1, username: 1 } }).toArray()) as StoredProfileRecord[];
  const normalizedHandle = normalizeUsername(handleParam);

  const profile = profiles.find((entry) => {
    const username = typeof entry.username === "string" ? entry.username : "";
    const handle = formatUsernameHandle(username);
    return normalizeUsername(username) === normalizedHandle || normalizeUsername(handle) === normalizedHandle;
  }) ?? null;

  return typeof profile?.address === "string" ? normalizeAddress(profile.address) : null;
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

    const { startDate, endDate, points } = buildDayRange(ANALYTICS_RANGE_DAYS);
    const pointsByDate = new Map(points.map((point) => [point.date, point]));
    const targetAddressRegex = buildAddressRegex(targetAddress);

    const [campaignRecordsCollection, campaignParticipantsCollection] = await Promise.all([
      getMongoCollection(),
      getCampaignParticipantsCollection(),
    ]);

    const [producedRecords, participantRows, rewardedRecords] = await Promise.all([
      campaignRecordsCollection.find(
        {
          status: "published",
          creatorAddress: { $regex: targetAddressRegex },
        },
        {
          projection: {
            _id: 0,
            chainCreatedAt: 1,
            createdAt: 1,
          },
        },
      ).toArray() as Promise<CampaignRecordAnalytics[]>,
      campaignParticipantsCollection.find(
        {
          participantAddress: targetAddress,
        },
        {
          projection: {
            _id: 0,
            joinedAt: 1,
            submittedAt: 1,
          },
        },
      ).toArray() as Promise<CampaignParticipantAnalytics[]>,
      campaignRecordsCollection.find(
        {
          settledRecipients: {
            $elemMatch: {
              address: { $regex: targetAddressRegex },
            },
          },
        },
        {
          projection: {
            _id: 0,
            settledAt: 1,
            updatedAt: 1,
            settledRecipients: 1,
          },
        },
      ).toArray() as Promise<CampaignRecordAnalytics[]>,
    ]);

    producedRecords.forEach((record) => {
      bucketEvent(pointsByDate, record.chainCreatedAt ?? record.createdAt, "produced");
    });

    participantRows.forEach((record) => {
      bucketEvent(pointsByDate, record.joinedAt ?? record.submittedAt, "participated");
    });

    rewardedRecords.forEach((record) => {
      const rewardedCount = countMatchingRecipients(record.settledRecipients, targetAddress);
      if (rewardedCount <= 0) {
        return;
      }

      bucketEvent(pointsByDate, record.settledAt ?? record.updatedAt, "rewarded", rewardedCount);
    });

    const totals = points.reduce(
      (summary, point) => ({
        produced: summary.produced + point.produced,
        participated: summary.participated + point.participated,
        rewarded: summary.rewarded + point.rewarded,
      }),
      { produced: 0, participated: 0, rewarded: 0 },
    );

    return NextResponse.json({
      range: {
        bucket: "day",
        startDate,
        endDate,
      },
      totals,
      points,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load profile analytics";
    return badRequest(message, 500);
  }
}
