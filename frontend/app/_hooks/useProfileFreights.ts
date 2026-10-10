"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { ProfileFreightRow } from "@/app/_types/profileTabs";
import { normalizeUsername } from "@/lib/campaignDisplay";

const profileFreightsCache = new Map<string, ProfileFreightRow[]>();
const dirtyProfileFreightsKeys = new Set<string>();

type UseProfileFreightsArgs = {
  address?: string | null;
  cacheKey?: string | null;
  enabled?: boolean;
  handle?: string | null;
};

function normalizeAddress(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function buildProfileFreightsCacheKey({ address, cacheKey, handle }: UseProfileFreightsArgs) {
  const normalizedCacheKey = cacheKey?.trim().toLowerCase() ?? "";
  if (normalizedCacheKey) {
    return normalizedCacheKey;
  }

  const normalizedAddress = normalizeAddress(address);
  if (normalizedAddress) {
    return `address:${normalizedAddress}`;
  }

  const normalizedHandle = handle ? normalizeUsername(handle) : "";
  if (normalizedHandle) {
    return `handle:${normalizedHandle}`;
  }

  return null;
}

function buildProfileFreightsQuery({ address, handle }: Pick<UseProfileFreightsArgs, "address" | "handle">) {
  const normalizedAddress = address?.trim();
  if (normalizedAddress) {
    return `address=${encodeURIComponent(normalizedAddress)}`;
  }

  const normalizedHandle = handle?.trim();
  if (normalizedHandle) {
    return `handle=${encodeURIComponent(normalizedHandle)}`;
  }

  return null;
}

export function markProfileFreightsDirty(args: Pick<UseProfileFreightsArgs, "address" | "cacheKey" | "handle">) {
  const key = buildProfileFreightsCacheKey(args);
  if (!key) {
    return;
  }

  dirtyProfileFreightsKeys.add(key);
}

export function useProfileFreights({ address, cacheKey, enabled = true, handle }: UseProfileFreightsArgs) {
  const [rows, setRows] = useState<ProfileFreightRow[]>([]);
  const [error, setError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const resolvedCacheKey = useMemo(() => buildProfileFreightsCacheKey({ address, cacheKey, handle }), [address, cacheKey, handle]);
  const query = useMemo(() => buildProfileFreightsQuery({ address, handle }), [address, handle]);

  const fetchRows = useCallback(async (forceRefresh = false) => {
    if (!resolvedCacheKey || !query) {
      return;
    }

    const cachedRows = profileFreightsCache.get(resolvedCacheKey) ?? null;
    const isDirty = dirtyProfileFreightsKeys.has(resolvedCacheKey);
    if (!forceRefresh && cachedRows && !isDirty) {
      setRows(cachedRows);
      setError("");
      setHasLoaded(true);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    if (forceRefresh || cachedRows) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError("");

    try {
      const response = await fetch(`/api/user-profiles/freights?${query}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load profile freights");
      }

      const nextRows = Array.isArray(payload?.rows) ? (payload.rows as ProfileFreightRow[]) : [];
      profileFreightsCache.set(resolvedCacheKey, nextRows);
      dirtyProfileFreightsKeys.delete(resolvedCacheKey);
      setRows(nextRows);
      setError("");
      setHasLoaded(true);
    } catch (nextError) {
      if (!cachedRows) {
        setRows([]);
        setError(nextError instanceof Error ? nextError.message : "Failed to load profile freights");
        setHasLoaded(true);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [query, resolvedCacheKey]);

  useEffect(() => {
    if (!resolvedCacheKey) {
      setRows([]);
      setError("");
      setHasLoaded(false);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    const cachedRows = profileFreightsCache.get(resolvedCacheKey) ?? null;
    if (cachedRows) {
      setRows(cachedRows);
      setError("");
      setHasLoaded(true);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    setRows([]);
    setError("");
    setHasLoaded(false);
    setIsLoading(false);
    setIsRefreshing(false);
  }, [resolvedCacheKey]);

  useEffect(() => {
    if (!enabled || !resolvedCacheKey || !query) {
      return;
    }

    if (!profileFreightsCache.has(resolvedCacheKey) || dirtyProfileFreightsKeys.has(resolvedCacheKey)) {
      void fetchRows(false);
    }
  }, [enabled, fetchRows, query, resolvedCacheKey]);

  const refresh = useCallback(() => {
    if (!resolvedCacheKey) {
      return;
    }

    dirtyProfileFreightsKeys.add(resolvedCacheKey);
    void fetchRows(true);
  }, [fetchRows, resolvedCacheKey]);

  return {
    error,
    hasLoaded,
    isLoading,
    isRefreshing,
    refresh,
    rows,
  };
}
