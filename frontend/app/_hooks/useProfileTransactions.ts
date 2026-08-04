"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { ProfileTransactionRow, ProfileTransactionsCoverage } from "@/app/_types/profileTabs";

const profileTransactionsCache = new Map<string, { coverage: ProfileTransactionsCoverage; rows: ProfileTransactionRow[] }>();

type UseProfileTransactionsArgs = {
  address?: string | null;
  enabled?: boolean;
  handle?: string | null;
};

const DEFAULT_COVERAGE: ProfileTransactionsCoverage = {
  complete: true,
  notes: [],
};

export function useProfileTransactions({ address, enabled = true, handle }: UseProfileTransactionsArgs) {
  const [coverage, setCoverage] = useState<ProfileTransactionsCoverage>(DEFAULT_COVERAGE);
  const [rows, setRows] = useState<ProfileTransactionRow[]>([]);
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

    const cached = profileTransactionsCache.get(query);
    if (!forceRefresh && cached) {
      setCoverage(cached.coverage);
      setRows(cached.rows);
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
      profileTransactionsCache.set(query, {
        coverage: nextCoverage,
        rows: nextRows,
      });
      setCoverage(nextCoverage);
      setRows(nextRows);
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
  }, [query]);

  useEffect(() => {
    if (!query) {
      setCoverage(DEFAULT_COVERAGE);
      setRows([]);
      setError("");
      setHasLoaded(false);
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    const cached = profileTransactionsCache.get(query);
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
  }, [fetchRows, query]);

  const refresh = useCallback(() => {
    void fetchRows(true);
  }, [fetchRows]);

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
