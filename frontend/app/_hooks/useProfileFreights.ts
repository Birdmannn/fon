"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { ProfileFreightRow } from "@/app/_types/profileTabs";

const profileFreightsCache = new Map<string, ProfileFreightRow[]>();

type UseProfileFreightsArgs = {
  address?: string | null;
  enabled?: boolean;
  handle?: string | null;
};

export function useProfileFreights({ address, enabled = true, handle }: UseProfileFreightsArgs) {
  const [rows, setRows] = useState<ProfileFreightRow[]>([]);
  const [error, setError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const query = useMemo(() => {
    if (!enabled) {
      return null;
    }

    const normalizedAddress = address?.trim();
    if (normalizedAddress) {
      return `address=${encodeURIComponent(normalizedAddress)}`;
    }

    const normalizedHandle = handle?.trim();
    if (normalizedHandle) {
      return `handle=${encodeURIComponent(normalizedHandle)}`;
    }

    return null;
  }, [address, enabled, handle]);

  const fetchRows = useCallback(async (forceRefresh = false) => {
    if (!query) {
      return;
    }

    const hasCachedRows = profileFreightsCache.has(query);
    if (!forceRefresh && hasCachedRows) {
      setRows(profileFreightsCache.get(query) ?? []);
      setError("");
      setHasLoaded(true);
      setIsLoading(false);
      return;
    }

    if (forceRefresh) {
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
      profileFreightsCache.set(query, nextRows);
      setRows(nextRows);
      setHasLoaded(true);
    } catch (nextError) {
      if (!hasCachedRows) {
        setRows([]);
        setError(nextError instanceof Error ? nextError.message : "Failed to load profile freights");
        setHasLoaded(true);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [query]);

  useEffect(() => {
    if (!query) {
      setRows([]);
      setError("");
      setHasLoaded(false);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    const cachedRows = profileFreightsCache.get(query);
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
  }, [fetchRows, query]);

  const refresh = useCallback(() => {
    void fetchRows(true);
  }, [fetchRows]);

  return {
    error,
    hasLoaded,
    isLoading,
    isRefreshing,
    refresh,
    rows,
  };
}
