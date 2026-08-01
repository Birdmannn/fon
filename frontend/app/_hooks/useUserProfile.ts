"use client";

import { useCallback, useEffect, useState } from "react";

import { ccc } from "@ckb-ccc/connector-react";

export type LeaderboardEntry = {
  address: string;
  username: string;
  handle: string;
  displayName: string;
  fbars: number;
  adsfUsdCents: number;
  rank: number;
  updatedAt?: string | null;
  lastSeenAt?: string | null;
};

export type UserProfile = LeaderboardEntry & {
  overallRank: number;
  weeklyRank: number;
  canEditWeeklyMarquee: boolean;
  weeklyMarqueeMessage?: string | null;
  weeklyMarqueeWeekKey?: string | null;
};

export type WeeklyMarqueeOwner = {
  address: string;
  username: string;
  handle: string;
  displayName: string;
};

export function formatAdsfUsdParts(valueUsdCents: number | null | undefined) {
  if (typeof valueUsdCents !== "number" || !Number.isFinite(valueUsdCents) || valueUsdCents < 0) {
    return null;
  }

  const whole = Math.round(valueUsdCents / 100).toLocaleString();
  return { whole };
}

export function useUserProfile(signer: ccc.Signer | null, targetHandle?: string | null) {
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [weeklyLeaderboard, setWeeklyLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [overallLeaderboard, setOverallLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [activeWeeklyMarqueeMessage, setActiveWeeklyMarqueeMessage] = useState<string | null>(null);
  const [activeWeeklyMarqueeWeekKey, setActiveWeeklyMarqueeWeekKey] = useState<string | null>(null);
  const [activeWeeklyMarqueeOwner, setActiveWeeklyMarqueeOwner] = useState<WeeklyMarqueeOwner | null>(null);
  const [userProfileError, setUserProfileError] = useState("");
  const [isUserProfileLoading, setIsUserProfileLoading] = useState(false);
  const [isSavingUserProfile, setIsSavingUserProfile] = useState(false);

  useEffect(() => {
    if (!signer && !targetHandle) {
      setCurrentUserProfile(null);
      setLeaderboard([]);
      setWeeklyLeaderboard([]);
      setOverallLeaderboard([]);
      setActiveWeeklyMarqueeMessage(null);
      setActiveWeeklyMarqueeWeekKey(null);
      setActiveWeeklyMarqueeOwner(null);
      setUserProfileError("");
      setIsUserProfileLoading(false);
      setIsSavingUserProfile(false);
      return;
    }

    let cancelled = false;
    setIsUserProfileLoading(true);
    setUserProfileError("");

    void (async () => {
      try {
        const response = targetHandle
          ? await fetch(`/api/user-profiles?handle=${encodeURIComponent(targetHandle)}`, {
              cache: "no-store",
            })
          : await (async () => {
              if (!signer) {
                throw new Error("Connect a wallet first");
              }

              const address = await signer.getRecommendedAddress();
              if (!address) {
                throw new Error("Unable to resolve wallet address");
              }

              return fetch("/api/user-profiles", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ address }),
              });
            })();
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error ?? "Failed to load user profile");
        }

        if (!cancelled) {
          const nextWeeklyLeaderboard = Array.isArray(payload?.weeklyLeaderboard)
            ? payload.weeklyLeaderboard as LeaderboardEntry[]
            : Array.isArray(payload?.leaderboard)
              ? payload.leaderboard as LeaderboardEntry[]
              : [];
          const nextOverallLeaderboard = Array.isArray(payload?.overallLeaderboard)
            ? payload.overallLeaderboard as LeaderboardEntry[]
            : [];

          setCurrentUserProfile(payload?.profile ?? null);
          setLeaderboard(nextWeeklyLeaderboard);
          setWeeklyLeaderboard(nextWeeklyLeaderboard);
          setOverallLeaderboard(nextOverallLeaderboard);
          setActiveWeeklyMarqueeMessage(typeof payload?.activeWeeklyMarqueeMessage === "string" ? payload.activeWeeklyMarqueeMessage : null);
          setActiveWeeklyMarqueeWeekKey(typeof payload?.activeWeeklyMarqueeWeekKey === "string" ? payload.activeWeeklyMarqueeWeekKey : null);
          setActiveWeeklyMarqueeOwner(payload?.activeWeeklyMarqueeOwner ?? null);
        }
      } catch (error) {
        if (!cancelled) {
          setUserProfileError(error instanceof Error ? error.message : "Failed to load user profile");
          setCurrentUserProfile(null);
          setLeaderboard([]);
          setWeeklyLeaderboard([]);
          setOverallLeaderboard([]);
          setActiveWeeklyMarqueeMessage(null);
          setActiveWeeklyMarqueeWeekKey(null);
          setActiveWeeklyMarqueeOwner(null);
        }
      } finally {
        if (!cancelled) {
          setIsUserProfileLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signer, targetHandle]);

  const saveDisplayName = useCallback(async (displayName: string) => {
    if (!signer) {
      throw new Error("Connect a wallet first");
    }

    const address = await signer.getRecommendedAddress();
    if (!address) {
      throw new Error("Unable to resolve wallet address");
    }

    setIsSavingUserProfile(true);
    setUserProfileError("");

    try {
      const response = await fetch("/api/user-profiles", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address, displayName }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to update display name");
      }

      const nextWeeklyLeaderboard = Array.isArray(payload?.weeklyLeaderboard)
        ? payload.weeklyLeaderboard as LeaderboardEntry[]
        : Array.isArray(payload?.leaderboard)
          ? payload.leaderboard as LeaderboardEntry[]
          : [];
      const nextOverallLeaderboard = Array.isArray(payload?.overallLeaderboard)
        ? payload.overallLeaderboard as LeaderboardEntry[]
        : [];

      setCurrentUserProfile(payload?.profile ?? null);
      setLeaderboard(nextWeeklyLeaderboard);
      setWeeklyLeaderboard(nextWeeklyLeaderboard);
      setOverallLeaderboard(nextOverallLeaderboard);
      setActiveWeeklyMarqueeMessage(typeof payload?.activeWeeklyMarqueeMessage === "string" ? payload.activeWeeklyMarqueeMessage : null);
      setActiveWeeklyMarqueeWeekKey(typeof payload?.activeWeeklyMarqueeWeekKey === "string" ? payload.activeWeeklyMarqueeWeekKey : null);
      setActiveWeeklyMarqueeOwner(payload?.activeWeeklyMarqueeOwner ?? null);
      return payload?.profile as UserProfile | null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update display name";
      setUserProfileError(message);
      throw error;
    } finally {
      setIsSavingUserProfile(false);
    }
  }, [signer]);

  const saveWeeklyMarqueeMessage = useCallback(async (weeklyMarqueeMessage: string) => {
    if (!signer) {
      throw new Error("Connect a wallet first");
    }

    const address = await signer.getRecommendedAddress();
    if (!address) {
      throw new Error("Unable to resolve wallet address");
    }

    setIsSavingUserProfile(true);
    setUserProfileError("");

    try {
      const response = await fetch("/api/user-profiles", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address, weeklyMarqueeMessage }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to update weekly marquee message");
      }

      const nextWeeklyLeaderboard = Array.isArray(payload?.weeklyLeaderboard)
        ? payload.weeklyLeaderboard as LeaderboardEntry[]
        : Array.isArray(payload?.leaderboard)
          ? payload.leaderboard as LeaderboardEntry[]
          : [];
      const nextOverallLeaderboard = Array.isArray(payload?.overallLeaderboard)
        ? payload.overallLeaderboard as LeaderboardEntry[]
        : [];

      setCurrentUserProfile(payload?.profile ?? null);
      setLeaderboard(nextWeeklyLeaderboard);
      setWeeklyLeaderboard(nextWeeklyLeaderboard);
      setOverallLeaderboard(nextOverallLeaderboard);
      setActiveWeeklyMarqueeMessage(typeof payload?.activeWeeklyMarqueeMessage === "string" ? payload.activeWeeklyMarqueeMessage : null);
      setActiveWeeklyMarqueeWeekKey(typeof payload?.activeWeeklyMarqueeWeekKey === "string" ? payload.activeWeeklyMarqueeWeekKey : null);
      setActiveWeeklyMarqueeOwner(payload?.activeWeeklyMarqueeOwner ?? null);
      return payload?.profile as UserProfile | null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update weekly marquee message";
      setUserProfileError(message);
      throw error;
    } finally {
      setIsSavingUserProfile(false);
    }
  }, [signer]);

  return {
    activeWeeklyMarqueeMessage,
    activeWeeklyMarqueeOwner,
    activeWeeklyMarqueeWeekKey,
    currentUserProfile,
    isSavingUserProfile,
    isUserProfileLoading,
    leaderboard,
    overallLeaderboard,
    saveDisplayName,
    saveWeeklyMarqueeMessage,
    setCurrentUserProfile,
    userProfileError,
    weeklyLeaderboard,
  };
}
