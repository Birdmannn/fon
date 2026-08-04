"use client";

import { useEffect, useMemo, useState } from "react";

import type { ProfileFreightRow } from "@/app/_types/profileTabs";

type UseProfileFreightsArgs = {
  address?: string | null;
  enabled?: boolean;
  handle?: string | null;
};

export function useProfileFreights({ address, enabled = true, handle }: UseProfileFreightsArgs) {
  const [rows, setRows] = useState<ProfileFreightRow[]>([]);
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
        const response = await fetch(`/api/user-profiles/freights?${query}`, {
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error ?? "Failed to load profile freights");
        }

        if (!cancelled) {
          setRows(Array.isArray(payload?.rows) ? (payload.rows as ProfileFreightRow[]) : []);
        }
      } catch (nextError) {
        if (!cancelled) {
          setRows([]);
          setError(nextError instanceof Error ? nextError.message : "Failed to load profile freights");
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
    error,
    isLoading,
    rows,
  };
}
