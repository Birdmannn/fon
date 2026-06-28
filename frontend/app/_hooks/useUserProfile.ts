"use client";

import { useCallback, useEffect, useState } from "react";

import { ccc } from "@ckb-ccc/connector-react";

export type LeaderboardEntry = {
  address: string;
  username: string;
  handle: string;
  fbars: number;
  rank: number;
  updatedAt?: string | null;
  lastSeenAt?: string | null;
};

export type UserProfile = LeaderboardEntry;

export function useUserProfile(signer: ccc.Signer | null) {
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userProfileError, setUserProfileError] = useState("");
  const [isUserProfileLoading, setIsUserProfileLoading] = useState(false);
  const [isSavingUserProfile, setIsSavingUserProfile] = useState(false);

  useEffect(() => {
    if (!signer) {
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
        const address = await signer.getRecommendedAddress();
        if (!address) {
          throw new Error("Unable to resolve wallet address");
        }

        const response = await fetch("/api/user-profiles", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ address }),
        });
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
  }, [signer]);

  const saveUsername = useCallback(async (username: string) => {
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
        body: JSON.stringify({ address, username }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to update username");
      }

      setCurrentUserProfile(payload?.profile ?? null);
      setLeaderboard(Array.isArray(payload?.leaderboard) ? payload.leaderboard as LeaderboardEntry[] : []);
      return payload?.profile as UserProfile | null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update username";
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
    saveUsername,
    setCurrentUserProfile,
    userProfileError,
  };
}
