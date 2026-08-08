"use client";

import { useCallback, useEffect, useState } from "react";

import { ccc } from "@ckb-ccc/connector-react";

import type { LightModePrimaryColor } from "@/lib/lightModePrimaryColor";
import {
  normalizeLightModePrimaryColor,
  persistLightModePrimaryColor,
} from "@/lib/lightModePrimaryColor";
import {
  clearWalletSeedIntent,
  finishWalletSeedAttempt,
  hasWalletSeedIntent,
  startWalletSeedAttempt,
} from "@/lib/walletSeed";

export type LeaderboardEntry = {
  address: string;
  username: string;
  handle: string;
  displayName: string;
  fbars: number;
  weeklyFbars: number;
  adsfUsdCents: number;
  rank: number;
  updatedAt?: string | null;
  lastSeenAt?: string | null;
};

export type UserProfileGoogleAccount = {
  sub: string;
  email: string;
  emailVerified: boolean;
  picture?: string | null;
  linkedAt?: string | null;
  lastRefreshedAt?: string | null;
};

export type UserProfile = LeaderboardEntry & {
  overallRank: number;
  weeklyRank: number;
  canEditWeeklyMarquee: boolean;
  lightModePrimaryColor: LightModePrimaryColor;
  weeklyMarqueeMessage?: string | null;
  weeklyMarqueeWeekKey?: string | null;
  weeklyMarqueeEditsUsed: number;
  weeklyMarqueeEditsRemaining: number;
  weeklyMarqueeMaxEdits: number;
  hasSeededWalletFbars: boolean;
  googleAccount?: UserProfileGoogleAccount | null;
};

export type WeeklyMarqueeOwner = {
  address: string;
  username: string;
  handle: string;
  displayName: string;
};

type UserProfilePayload = {
  profile?: UserProfile | null;
  leaderboard?: LeaderboardEntry[];
  weeklyLeaderboard?: LeaderboardEntry[];
  overallLeaderboard?: LeaderboardEntry[];
  activeWeeklyMarqueeMessage?: string | null;
  activeWeeklyMarqueeWeekKey?: string | null;
  activeWeeklyMarqueeOwner?: WeeklyMarqueeOwner | null;
  activeWeeklyMarqueeEditsUsed?: number;
  activeWeeklyMarqueeEditsRemaining?: number;
  activeWeeklyMarqueeMaxEdits?: number;
  error?: string;
};

function parseCount(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

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
  const [activeWeeklyMarqueeEditsUsed, setActiveWeeklyMarqueeEditsUsed] = useState(0);
  const [activeWeeklyMarqueeEditsRemaining, setActiveWeeklyMarqueeEditsRemaining] = useState(0);
  const [activeWeeklyMarqueeMaxEdits, setActiveWeeklyMarqueeMaxEdits] = useState(2);
  const [userProfileError, setUserProfileError] = useState("");
  const [isUserProfileLoading, setIsUserProfileLoading] = useState(false);
  const [isSavingUserProfile, setIsSavingUserProfile] = useState(false);
  const [isSeedingWalletFbars, setIsSeedingWalletFbars] = useState(false);

  const resetState = useCallback(() => {
    setCurrentUserProfile(null);
    setLeaderboard([]);
    setWeeklyLeaderboard([]);
    setOverallLeaderboard([]);
    setActiveWeeklyMarqueeMessage(null);
    setActiveWeeklyMarqueeWeekKey(null);
    setActiveWeeklyMarqueeOwner(null);
    setActiveWeeklyMarqueeEditsUsed(0);
    setActiveWeeklyMarqueeEditsRemaining(0);
    setActiveWeeklyMarqueeMaxEdits(2);
  }, []);

  const applyProfilePayload = useCallback((payload: UserProfilePayload | null) => {
    const nextWeeklyLeaderboard = Array.isArray(payload?.weeklyLeaderboard)
      ? payload.weeklyLeaderboard as LeaderboardEntry[]
      : Array.isArray(payload?.leaderboard)
        ? payload.leaderboard as LeaderboardEntry[]
        : [];
    const nextOverallLeaderboard = Array.isArray(payload?.overallLeaderboard)
      ? payload.overallLeaderboard as LeaderboardEntry[]
      : [];

    setCurrentUserProfile(payload?.profile ? {
      ...payload.profile,
      lightModePrimaryColor: normalizeLightModePrimaryColor(payload.profile.lightModePrimaryColor),
    } : null);
    setLeaderboard(nextWeeklyLeaderboard);
    setWeeklyLeaderboard(nextWeeklyLeaderboard);
    setOverallLeaderboard(nextOverallLeaderboard);
    setActiveWeeklyMarqueeMessage(typeof payload?.activeWeeklyMarqueeMessage === "string" ? payload.activeWeeklyMarqueeMessage : null);
    setActiveWeeklyMarqueeWeekKey(typeof payload?.activeWeeklyMarqueeWeekKey === "string" ? payload.activeWeeklyMarqueeWeekKey : null);
    setActiveWeeklyMarqueeOwner(payload?.activeWeeklyMarqueeOwner ?? null);
    setActiveWeeklyMarqueeEditsUsed(parseCount(payload?.activeWeeklyMarqueeEditsUsed));
    setActiveWeeklyMarqueeEditsRemaining(parseCount(payload?.activeWeeklyMarqueeEditsRemaining));
    setActiveWeeklyMarqueeMaxEdits(parseCount(payload?.activeWeeklyMarqueeMaxEdits, 2));
  }, []);

  const loadProfile = useCallback(async () => {
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

    applyProfilePayload(payload);
    return payload;
  }, [applyProfilePayload, signer, targetHandle]);

  useEffect(() => {
    if (!signer && !targetHandle) {
      resetState();
      setUserProfileError("");
      setIsUserProfileLoading(false);
      setIsSavingUserProfile(false);
      setIsSeedingWalletFbars(false);
      return;
    }

    let cancelled = false;
    setIsUserProfileLoading(true);
    setUserProfileError("");

    void loadProfile()
      .catch((error) => {
        if (!cancelled) {
          setUserProfileError(error instanceof Error ? error.message : "Failed to load user profile");
          resetState();
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsUserProfileLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loadProfile, resetState, signer, targetHandle]);

  const seedWalletFbars = useCallback(async () => {
    if (!signer || targetHandle) {
      return null;
    }

    const address = await signer.getRecommendedAddress();
    if (!address) {
      throw new Error("Unable to resolve wallet address");
    }

    setIsSeedingWalletFbars(true);
    try {
      const nonceResponse = await fetch("/api/wallet/nonce", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address, purpose: "wallet-seed" }),
      });
      const noncePayload = await nonceResponse.json().catch(() => null);
      console.log("[wallet-seed] client nonce response", {
        address,
        noncePayload,
        ok: nonceResponse.ok,
        status: nonceResponse.status,
      });
      if (!nonceResponse.ok || typeof noncePayload?.nonce !== "string") {
        throw new Error(noncePayload?.error ?? "Failed to create wallet seed nonce");
      }

      const signature = await signer.signMessage(noncePayload.nonce);
      console.log("[wallet-seed] client signMessage result", {
        address,
        nonce: noncePayload.nonce,
        signature: {
          identity: signature.identity,
          signType: signature.signType,
          signaturePreview: `${signature.signature.slice(0, 14)}…${signature.signature.slice(-10)}`,
        },
      });
      const response = await fetch("/api/user-profiles/seed", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address,
          nonce: noncePayload.nonce,
          signature: {
            signature: signature.signature,
            identity: signature.identity,
            signType: signature.signType,
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      console.log("[wallet-seed] client seed response", {
        address,
        ok: response.ok,
        payload,
        status: response.status,
      });
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to seed wallet FBARS");
      }

      await loadProfile();
      return payload;
    } finally {
      setIsSeedingWalletFbars(false);
    }
  }, [loadProfile, signer, targetHandle]);

  useEffect(() => {
    if (!signer || targetHandle || isUserProfileLoading || isSeedingWalletFbars) {
      return;
    }

    if (!currentUserProfile) {
      return;
    }

    const address = currentUserProfile.address;

    if (currentUserProfile.hasSeededWalletFbars) {
      clearWalletSeedIntent();
      finishWalletSeedAttempt(address);
      return;
    }

    if (!hasWalletSeedIntent()) {
      return;
    }

    if (!startWalletSeedAttempt(address)) {
      return;
    }

    clearWalletSeedIntent();
    void seedWalletFbars()
      .catch((error) => {
        setUserProfileError(error instanceof Error ? error.message : "Failed to seed wallet FBARS");
      })
      .finally(() => {
        finishWalletSeedAttempt(address);
      });
  }, [currentUserProfile, isSeedingWalletFbars, isUserProfileLoading, seedWalletFbars, signer, targetHandle]);

  useEffect(() => {
    if (targetHandle || !currentUserProfile?.lightModePrimaryColor) {
      return;
    }

    persistLightModePrimaryColor(currentUserProfile.lightModePrimaryColor);
  }, [currentUserProfile?.lightModePrimaryColor, targetHandle]);

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

      applyProfilePayload(payload);
      return payload?.profile as UserProfile | null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update display name";
      setUserProfileError(message);
      throw error;
    } finally {
      setIsSavingUserProfile(false);
    }
  }, [applyProfilePayload, signer]);

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
      const nonceResponse = await fetch("/api/wallet/nonce", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address, purpose: "marquee-edit" }),
      });
      const noncePayload = await nonceResponse.json().catch(() => null);
      if (!nonceResponse.ok || typeof noncePayload?.nonce !== "string") {
        throw new Error(noncePayload?.error ?? "Failed to create marquee edit nonce");
      }

      const signature = await signer.signMessage(noncePayload.nonce);
      const response = await fetch("/api/user-profiles", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address,
          weeklyMarqueeMessage,
          nonce: noncePayload.nonce,
          signature: {
            signature: signature.signature,
            identity: signature.identity,
            signType: signature.signType,
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to update weekly marquee message");
      }

      applyProfilePayload(payload);
      return payload?.profile as UserProfile | null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update weekly marquee message";
      setUserProfileError(message);
      throw error;
    } finally {
      setIsSavingUserProfile(false);
    }
  }, [applyProfilePayload, signer]);

  const saveLightModePrimaryColor = useCallback(async (lightModePrimaryColor: LightModePrimaryColor) => {
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
        body: JSON.stringify({
          address,
          lightModePrimaryColor,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to update light mode primary color");
      }

      applyProfilePayload(payload);
      const nextProfile = payload?.profile as UserProfile | null;
      if (nextProfile?.lightModePrimaryColor) {
        persistLightModePrimaryColor(nextProfile.lightModePrimaryColor);
      }
      return nextProfile;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update light mode primary color";
      setUserProfileError(message);
      throw error;
    } finally {
      setIsSavingUserProfile(false);
    }
  }, [applyProfilePayload, signer]);

  return {
    activeWeeklyMarqueeEditsRemaining,
    activeWeeklyMarqueeEditsUsed,
    activeWeeklyMarqueeMaxEdits,
    activeWeeklyMarqueeMessage,
    activeWeeklyMarqueeOwner,
    activeWeeklyMarqueeWeekKey,
    currentUserProfile,
    isSavingUserProfile,
    isSeedingWalletFbars,
    isUserProfileLoading,
    leaderboard,
    overallLeaderboard,
    saveDisplayName,
    saveLightModePrimaryColor,
    saveWeeklyMarqueeMessage,
    seedWalletFbars,
    setCurrentUserProfile,
    userProfileError,
    weeklyLeaderboard,
  };
}
