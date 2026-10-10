"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { ProfileTransactionRow, ProfileTransactionsCoverage } from "@/app/_types/profileTabs";
import { normalizeUsername } from "@/lib/campaignDisplay";

const profileTransactionsCache = new Map<string, { coverage: ProfileTransactionsCoverage; rows: ProfileTransactionRow[] }>();
const dirtyProfileTransactionsKeys = new Set<string>();

type UseProfileTransactionsArgs = {
  address?: string | null;
  cacheKey?: string | null;
  enabled?: boolean;
  handle?: string | null;
};

const DEFAULT_COVERAGE: ProfileTransactionsCoverage = {
  complete: true,
  notes: [],
};

function normalizeAddress(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function buildProfileTransactionsCacheKey({ address, cacheKey, handle }: UseProfileTransactionsArgs) {
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

function buildProfileTransactionsQuery({ address, handle }: Pick<UseProfileTransactionsArgs, "address" | "handle">) {
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

export function markProfileTransactionsDirty(args: Pick<UseProfileTransactionsArgs, "address" | "cacheKey" | "handle">) {
  const key = buildProfileTransactionsCacheKey(args);
  if (!key) {
    return;
  }

  dirtyProfileTransactionsKeys.add(key);
}

export function useProfileTransactions({ address, cacheKey, enabled = true, handle }: UseProfileTransactionsArgs) {
  const [coverage, setCoverage] = useState<ProfileTransactionsCoverage>(DEFAULT_COVERAGE);
  const [rows, setRows] = useState<ProfileTransactionRow[]>([]);
  const [error, setError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const resolvedCacheKey = useMemo(() => buildProfileTransactionsCacheKey({ address, cacheKey, handle }), [address, cacheKey, handle]);
  const query = useMemo(() => buildProfileTransactionsQuery({ address, handle }), [address, handle]);

  const fetchRows = useCallback(async (forceRefresh = false) => {
    if (!resolvedCacheKey || !query) {
      return;
    }

    const cached = profileTransactionsCache.get(resolvedCacheKey) ?? null;
    const isDirty = dirtyProfileTransactionsKeys.has(resolvedCacheKey);
    if (!forceRefresh && cached && !isDirty) {
      setCoverage(cached.coverage);
      setRows(cached.rows);
      setError("");
      setHasLoaded(true);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    if (forceRefresh || cached) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError("");

    try {
      const response = await fetch(`/api/user-profiles/transactions?${query}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load profile transactions");
      }

      const nextCoverage = payload?.coverage && typeof payload.coverage === "object"
        ? payload.coverage as ProfileTransactionsCoverage
        : DEFAULT_COVERAGE;
      const nextRows = Array.isArray(payload?.rows) ? (payload.rows as ProfileTransactionRow[]) : [];
      profileTransactionsCache.set(resolvedCacheKey, {
        coverage: nextCoverage,
        rows: nextRows,
      });
      dirtyProfileTransactionsKeys.delete(resolvedCacheKey);
      setCoverage(nextCoverage);
      setRows(nextRows);
      setError("");
      setHasLoaded(true);
    } catch (nextError) {
      if (!cached) {
        setCoverage(DEFAULT_COVERAGE);
        setRows([]);
        setError(nextError instanceof Error ? nextError.message : "Failed to load profile transactions");
        setHasLoaded(true);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [query, resolvedCacheKey]);

  useEffect(() => {
    if (!resolvedCacheKey) {
      setCoverage(DEFAULT_COVERAGE);
      setRows([]);
      setError("");
      setHasLoaded(false);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    const cached = profileTransactionsCache.get(resolvedCacheKey) ?? null;
    if (cached) {
      setCoverage(cached.coverage);
      setRows(cached.rows);
      setError("");
      setHasLoaded(true);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    setCoverage(DEFAULT_COVERAGE);
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

    if (!profileTransactionsCache.has(resolvedCacheKey) || dirtyProfileTransactionsKeys.has(resolvedCacheKey)) {
      void fetchRows(false);
    }
  }, [enabled, fetchRows, query, resolvedCacheKey]);

  const refresh = useCallback(() => {
    if (!resolvedCacheKey) {
      return;
    }

    dirtyProfileTransactionsKeys.add(resolvedCacheKey);
    void fetchRows(true);
  }, [fetchRows, resolvedCacheKey]);

  return {
    coverage,
    error,
    hasLoaded,
    isLoading,
    isRefreshing,
    refresh,
    rows,
  };
}
