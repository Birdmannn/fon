type RankedProfile = {
  address?: unknown;
  updatedAt?: unknown;
};

function updatedAtMs(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value) || 0;
  return 0;
}

export function uniqueProfilesByAddress<T extends RankedProfile>(profiles: T[]): T[] {
  const byAddress = new Map<string, T>();

  for (const profile of profiles) {
    const address = typeof profile.address === "string" ? profile.address.trim().toLowerCase() : "";
    if (!address) continue;

    const current = byAddress.get(address);
    if (!current || updatedAtMs(profile.updatedAt) > updatedAtMs(current.updatedAt)) {
      byAddress.set(address, profile);
    }
  }

  return [...byAddress.values()];
}
