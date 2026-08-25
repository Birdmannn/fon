"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { normalizeUsername } from "@/lib/campaignDisplay";

export type ProfileAnalyticsPoint = {
  date: string;
  produced: number;
  participated: number;
  rewarded: number;
};

export type ProfileAnalytics = {
  range: {
    bucket: "day";
    startDate: string;
    endDate: string;
  };
  totals: {
    produced: number;
    participated: number;
    rewarded: number;
  };
  points: ProfileAnalyticsPoint[];
};

type UseProfileAnalyticsArgs = {
  address?: string | null;
  cacheKey?: string | null;
  enabled?: boolean;
  handle?: string | null;
};

const profileAnalyticsCache = new Map<string, ProfileAnalytics>();
const dirtyProfileAnalyticsKeys = new Set<string>();

function normalizeAddress(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function buildProfileAnalyticsCacheKey({ address, cacheKey, handle }: UseProfileAnalyticsArgs) {
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

function buildProfileAnalyticsQuery({ address, handle }: UseProfileAnalyticsArgs) {
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

export function markProfileAnalyticsDirty(args: Pick<UseProfileAnalyticsArgs, "address" | "cacheKey" | "handle">) {
  const key = buildProfileAnalyticsCacheKey(args);
  if (!key) {
    return;
  }

  dirtyProfileAnalyticsKeys.add(key);
}

export function useProfileAnalytics({ address, cacheKey, enabled = true, handle }: UseProfileAnalyticsArgs) {
  const [analytics, setAnalytics] = useState<ProfileAnalytics | null>(null);
  const [error, setError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const resolvedCacheKey = useMemo(() => buildProfileAnalyticsCacheKey({ address, cacheKey, handle }), [address, cacheKey, handle]);
  const query = useMemo(() => buildProfileAnalyticsQuery({ address, handle }), [address, handle]);

  const fetchAnalytics = useCallback(async (forceRefresh = false) => {
    if (!resolvedCacheKey || !query) {
      return;
    }

    const cachedAnalytics = profileAnalyticsCache.get(resolvedCacheKey) ?? null;
    const isDirty = dirtyProfileAnalyticsKeys.has(resolvedCacheKey);
    if (!forceRefresh && cachedAnalytics && !isDirty) {
      setAnalytics(cachedAnalytics);
      setError("");
      setHasLoaded(true);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    if (forceRefresh || cachedAnalytics) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError("");

    try {
      const response = await fetch(`/api/user-profiles/analytics?${query}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load profile analytics");
      }

      const nextAnalytics = payload as ProfileAnalytics;
      profileAnalyticsCache.set(resolvedCacheKey, nextAnalytics);
      dirtyProfileAnalyticsKeys.delete(resolvedCacheKey);
      setAnalytics(nextAnalytics);
      setError("");
      setHasLoaded(true);
    } catch (nextError) {
      if (!cachedAnalytics) {
        setAnalytics(null);
        setError(nextError instanceof Error ? nextError.message : "Failed to load profile analytics");
        setHasLoaded(true);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [query, resolvedCacheKey]);

  useEffect(() => {
    if (!resolvedCacheKey) {
      setAnalytics(null);
      setError("");
      setHasLoaded(false);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    const cachedAnalytics = profileAnalyticsCache.get(resolvedCacheKey) ?? null;
    if (cachedAnalytics) {
      setAnalytics(cachedAnalytics);
      setError("");
      setHasLoaded(true);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    setAnalytics(null);
    setError("");
    setHasLoaded(false);
    setIsLoading(false);
    setIsRefreshing(false);
  }, [resolvedCacheKey]);

  useEffect(() => {
    if (!enabled || !resolvedCacheKey || !query) {
      return;
    }

    if (!profileAnalyticsCache.has(resolvedCacheKey) || dirtyProfileAnalyticsKeys.has(resolvedCacheKey)) {
      void fetchAnalytics(false);
    }
  }, [enabled, fetchAnalytics, query, resolvedCacheKey]);

  const refresh = useCallback(() => {
    if (!resolvedCacheKey) {
      return;
    }

    dirtyProfileAnalyticsKeys.add(resolvedCacheKey);
    void fetchAnalytics(true);
  }, [fetchAnalytics, resolvedCacheKey]);

  return {
    analytics,
    error,
    hasLoaded,
    isLoading,
    isRefreshing,
    refresh,
  };
}
