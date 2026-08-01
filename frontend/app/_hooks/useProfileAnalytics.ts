"use client";

import { useEffect, useMemo, useState } from "react";

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
  handle?: string | null;
};

export function useProfileAnalytics({ address, handle }: UseProfileAnalyticsArgs) {
  const [analytics, setAnalytics] = useState<ProfileAnalytics | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const query = useMemo(() => {
    const normalizedAddress = address?.trim();
    if (normalizedAddress) {
      return `address=${encodeURIComponent(normalizedAddress)}`;
    }

    const normalizedHandle = handle?.trim();
    if (normalizedHandle) {
      return `handle=${encodeURIComponent(normalizedHandle)}`;
    }

    return null;
  }, [address, handle]);

  useEffect(() => {
    if (!query) {
      setAnalytics(null);
      setError("");
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError("");

    void (async () => {
      try {
        const response = await fetch(`/api/user-profiles/analytics?${query}`, {
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error ?? "Failed to load profile analytics");
        }

        if (!cancelled) {
          setAnalytics(payload as ProfileAnalytics);
        }
      } catch (nextError) {
        if (!cancelled) {
          setAnalytics(null);
          setError(nextError instanceof Error ? nextError.message : "Failed to load profile analytics");
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
    analytics,
    error,
    isLoading,
  };
}
