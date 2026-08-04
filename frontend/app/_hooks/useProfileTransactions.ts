"use client";

import { useEffect, useMemo, useState } from "react";

import type { ProfileTransactionRow, ProfileTransactionsCoverage } from "@/app/_types/profileTabs";

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
  const [isLoading, setIsLoading] = useState(false);

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

  useEffect(() => {
    if (!query) {
      setCoverage(DEFAULT_COVERAGE);
      setRows([]);
      setError("");
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError("");

    void (async () => {
      try {
        const response = await fetch(`/api/user-profiles/transactions?${query}`, {
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error ?? "Failed to load profile transactions");
        }

        if (!cancelled) {
          setCoverage(payload?.coverage && typeof payload.coverage === "object"
            ? payload.coverage as ProfileTransactionsCoverage
            : DEFAULT_COVERAGE);
          setRows(Array.isArray(payload?.rows) ? (payload.rows as ProfileTransactionRow[]) : []);
        }
      } catch (nextError) {
        if (!cancelled) {
          setCoverage(DEFAULT_COVERAGE);
          setRows([]);
          setError(nextError instanceof Error ? nextError.message : "Failed to load profile transactions");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [query]);

  return {
    coverage,
    error,
    isLoading,
    rows,
  };
}
