import { getUserProfilesCollection } from "@/lib/mongodb";

export type StoredProfileRecord = {
  address?: unknown;
  username?: unknown;
};

export function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string) {
  return value.trim().replace(/\.ckb$/i, "").toLowerCase();
}

export function formatUsernameHandle(username: string) {
  const normalized = username.trim().replace(/\.ckb$/i, "");
  return normalized ? `${normalized}.ckb` : "";
}

export function parseDateValue(value: unknown) {
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

export function toIsoDateTime(value: unknown) {
  return parseDateValue(value)?.toISOString() ?? null;
}

export function toUtcDayKey(value: unknown) {
  const parsedDate = parseDateValue(value);
  return parsedDate ? parsedDate.toISOString().slice(0, 10) : null;
}

export function buildAddressRegex(address: string) {
  const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`, "i");
}

export async function resolveTargetAddress(addressParam: string | null | undefined, handleParam: string | null | undefined) {
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
