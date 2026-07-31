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

export type UserProfile = LeaderboardEntry;

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
  const [userProfileError, setUserProfileError] = useState("");
  const [isUserProfileLoading, setIsUserProfileLoading] = useState(false);
  const [isSavingUserProfile, setIsSavingUserProfile] = useState(false);

  useEffect(() => {
    if (!signer && !targetHandle) {
      setCurrentUserProfile(null);
      setLeaderboard([]);
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
          setCurrentUserProfile(payload?.profile ?? null);
          setLeaderboard(Array.isArray(payload?.leaderboard) ? payload.leaderboard as LeaderboardEntry[] : []);
        }
      } catch (error) {
        if (!cancelled) {
          setUserProfileError(error instanceof Error ? error.message : "Failed to load user profile");
          setCurrentUserProfile(null);
          setLeaderboard([]);
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

      setCurrentUserProfile(payload?.profile ?? null);
      setLeaderboard(Array.isArray(payload?.leaderboard) ? payload.leaderboard as LeaderboardEntry[] : []);
      return payload?.profile as UserProfile | null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update display name";
      setUserProfileError(message);
      throw error;
    } finally {
      setIsSavingUserProfile(false);
    }
  }, [signer]);

  return {
    currentUserProfile,
    isSavingUserProfile,
    isUserProfileLoading,
    leaderboard,
    saveDisplayName,
    setCurrentUserProfile,
    userProfileError,
  };
}
