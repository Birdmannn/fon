"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { ccc } from "@ckb-ccc/connector-react";

import type { LightModePrimaryColor } from "@/lib/lightModePrimaryColor";
import {
  normalizeLightModePrimaryColor,
  persistLightModePrimaryColor,
} from "@/lib/lightModePrimaryColor";
import { normalizeUsername } from "@/lib/campaignDisplay";
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

export type ProfileViewTabKey = "activity" | "freights" | "transactions";

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

type ProfileTargetArgs = {
  address?: string | null;
  handle?: string | null;
  signer?: ccc.Signer | null;
};

type ProfileEntry = {
  activeWeeklyMarqueeEditsRemaining: number;
  activeWeeklyMarqueeEditsUsed: number;
  activeWeeklyMarqueeMaxEdits: number;
  activeWeeklyMarqueeMessage: string | null;
  activeWeeklyMarqueeOwner: WeeklyMarqueeOwner | null;
  activeWeeklyMarqueeWeekKey: string | null;
  currentUserProfile: UserProfile | null;
  dirty: boolean;
  hasLoaded: boolean;
  isSavingUserProfile: boolean;
  isSeedingWalletFbars: boolean;
  isUserProfileLoading: boolean;
  leaderboard: LeaderboardEntry[];
  overallLeaderboard: LeaderboardEntry[];
  userProfileError: string;
  weeklyLeaderboard: LeaderboardEntry[];
};

type ProfileViewState = {
  activeTab: ProfileViewTabKey;
};

type UserProfileContextValue = {
  entries: Record<string, ProfileEntry>;
  ensureLoaded: (args: ProfileTargetArgs, force?: boolean) => void;
  markDirty: (args: ProfileTargetArgs) => void;
  resetViewerRequest: () => void;
  resolveProfileKey: (args: ProfileTargetArgs) => string | null;
  saveDisplayName: (args: ProfileTargetArgs, displayName: string) => Promise<UserProfile | null>;
  saveLightModePrimaryColor: (args: ProfileTargetArgs, lightModePrimaryColor: LightModePrimaryColor) => Promise<UserProfile | null>;
  saveWeeklyMarqueeMessage: (args: ProfileTargetArgs, weeklyMarqueeMessage: string) => Promise<UserProfile | null>;
  seedWalletFbars: (args: ProfileTargetArgs) => Promise<unknown>;
  setActiveTab: (args: ProfileTargetArgs, value: ProfileViewTabKey) => void;
  setCurrentUserProfile: (args: ProfileTargetArgs, value: UserProfile | null | ((current: UserProfile | null) => UserProfile | null)) => void;
  viewStates: Record<string, ProfileViewState>;
};

const VIEWER_PROFILE_REQUEST_KEY = "viewer:connected";
const DEFAULT_PROFILE_TAB: ProfileViewTabKey = "activity";

function parseCount(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeAddress(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function buildAddressKey(value: string | null | undefined) {
  const normalized = normalizeAddress(value);
  return normalized ? `address:${normalized}` : null;
}

function buildHandleKey(value: string | null | undefined) {
  const normalized = value ? normalizeUsername(value) : "";
  return normalized ? `handle:${normalized}` : null;
}

function buildRequestedProfileKey(args: ProfileTargetArgs) {
  return buildAddressKey(args.address) ?? buildHandleKey(args.handle) ?? (args.signer ? VIEWER_PROFILE_REQUEST_KEY : null);
}

function createEmptyProfileEntry(): ProfileEntry {
  return {
    activeWeeklyMarqueeEditsRemaining: 0,
    activeWeeklyMarqueeEditsUsed: 0,
    activeWeeklyMarqueeMaxEdits: 2,
    activeWeeklyMarqueeMessage: null,
    activeWeeklyMarqueeOwner: null,
    activeWeeklyMarqueeWeekKey: null,
    currentUserProfile: null,
    dirty: false,
    hasLoaded: false,
    isSavingUserProfile: false,
    isSeedingWalletFbars: false,
    isUserProfileLoading: false,
    leaderboard: [],
    overallLeaderboard: [],
    userProfileError: "",
    weeklyLeaderboard: [],
  };
}

function createDefaultViewState(): ProfileViewState {
  return {
    activeTab: DEFAULT_PROFILE_TAB,
  };
}

function normalizeProfilePayload(payload: UserProfilePayload | null) {
  const nextWeeklyLeaderboard = Array.isArray(payload?.weeklyLeaderboard)
    ? payload.weeklyLeaderboard as LeaderboardEntry[]
    : Array.isArray(payload?.leaderboard)
      ? payload.leaderboard as LeaderboardEntry[]
      : [];
  const nextOverallLeaderboard = Array.isArray(payload?.overallLeaderboard)
    ? payload.overallLeaderboard as LeaderboardEntry[]
    : [];

  return {
    activeWeeklyMarqueeEditsRemaining: parseCount(payload?.activeWeeklyMarqueeEditsRemaining),
    activeWeeklyMarqueeEditsUsed: parseCount(payload?.activeWeeklyMarqueeEditsUsed),
    activeWeeklyMarqueeMaxEdits: parseCount(payload?.activeWeeklyMarqueeMaxEdits, 2),
    activeWeeklyMarqueeMessage: typeof payload?.activeWeeklyMarqueeMessage === "string" ? payload.activeWeeklyMarqueeMessage : null,
    activeWeeklyMarqueeOwner: payload?.activeWeeklyMarqueeOwner ?? null,
    activeWeeklyMarqueeWeekKey: typeof payload?.activeWeeklyMarqueeWeekKey === "string" ? payload.activeWeeklyMarqueeWeekKey : null,
    currentUserProfile: payload?.profile ? {
      ...payload.profile,
      lightModePrimaryColor: normalizeLightModePrimaryColor(payload.profile.lightModePrimaryColor),
    } : null,
    leaderboard: nextWeeklyLeaderboard,
    overallLeaderboard: nextOverallLeaderboard,
    weeklyLeaderboard: nextWeeklyLeaderboard,
  };
}

function collectProfileAliasKeys(profile: UserProfile | null, fallbackHandle?: string | null) {
  const aliasKeys = new Set<string>();

  const addressKey = buildAddressKey(profile?.address);
  if (addressKey) {
    aliasKeys.add(addressKey);
  }

  const usernameKey = buildHandleKey(profile?.username);
  if (usernameKey) {
    aliasKeys.add(usernameKey);
  }

  const handleKey = buildHandleKey(profile?.handle);
  if (handleKey) {
    aliasKeys.add(handleKey);
  }

  const fallbackHandleKey = buildHandleKey(fallbackHandle);
  if (fallbackHandleKey) {
    aliasKeys.add(fallbackHandleKey);
  }

  return [...aliasKeys];
}

function withUpdatedEntry(
  entries: Record<string, ProfileEntry>,
  key: string,
  updater: (current: ProfileEntry) => ProfileEntry,
) {
  return {
    ...entries,
    [key]: updater(entries[key] ?? createEmptyProfileEntry()),
  };
}

const UserProfileContext = createContext<UserProfileContextValue | null>(null);

export function formatAdsfUsdParts(valueUsdCents: number | null | undefined) {
  if (typeof valueUsdCents !== "number" || !Number.isFinite(valueUsdCents) || valueUsdCents < 0) {
    return null;
  }

  const whole = Math.round(valueUsdCents / 100).toLocaleString();
  return { whole };
}

export function UserProfileProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<Record<string, ProfileEntry>>({});
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [viewStates, setViewStates] = useState<Record<string, ProfileViewState>>({});
  const entriesRef = useRef(entries);
  const aliasesRef = useRef(aliases);
  const loadInFlightRef = useRef(new Set<string>());

  entriesRef.current = entries;
  aliasesRef.current = aliases;

  const resolveProfileKey = useCallback((args: ProfileTargetArgs) => {
    const requestedKey = buildRequestedProfileKey(args);
    if (!requestedKey) {
      return null;
    }

    return aliasesRef.current[requestedKey] ?? requestedKey;
  }, []);

  const setEntryFlags = useCallback((args: ProfileTargetArgs, updater: (current: ProfileEntry) => ProfileEntry) => {
    const requestedKey = buildRequestedProfileKey(args);
    if (!requestedKey) {
      return;
    }

    const resolvedKey = aliasesRef.current[requestedKey] ?? requestedKey;
    setEntries((current) => withUpdatedEntry(current, resolvedKey, updater));
  }, []);

  const applyPayload = useCallback((args: ProfileTargetArgs, payload: UserProfilePayload | null) => {
    const requestedKey = buildRequestedProfileKey(args);
    if (!requestedKey) {
      return;
    }

    const normalizedPayload = normalizeProfilePayload(payload);
    const aliasKeys = collectProfileAliasKeys(normalizedPayload.currentUserProfile, args.handle ?? null);
    const canonicalKey = aliasKeys.find((key) => key.startsWith("address:")) ?? (aliasesRef.current[requestedKey] ?? requestedKey);

    setEntries((current) => {
      const currentRequestedEntry = current[aliasesRef.current[requestedKey] ?? requestedKey] ?? current[requestedKey] ?? createEmptyProfileEntry();
      const currentCanonicalEntry = current[canonicalKey] ?? currentRequestedEntry;
      const nextEntry: ProfileEntry = {
        ...currentCanonicalEntry,
        ...normalizedPayload,
        dirty: false,
        hasLoaded: true,
        isSavingUserProfile: false,
        isSeedingWalletFbars: false,
        isUserProfileLoading: false,
        userProfileError: "",
      };

      const nextEntries = {
        ...current,
        [canonicalKey]: nextEntry,
      };

      if (requestedKey !== canonicalKey) {
        delete nextEntries[requestedKey];
      }

      return nextEntries;
    });

    setAliases((current) => {
      const nextAliases = {
        ...current,
        [requestedKey]: canonicalKey,
        [canonicalKey]: canonicalKey,
      };

      aliasKeys.forEach((key) => {
        nextAliases[key] = canonicalKey;
      });

      return nextAliases;
    });

    setViewStates((current) => {
      if (requestedKey === canonicalKey) {
        return current;
      }

      const requestedViewState = current[requestedKey];
      if (!requestedViewState) {
        return current;
      }

      const nextViewStates = {
        ...current,
        [canonicalKey]: current[canonicalKey] ?? requestedViewState,
      };
      delete nextViewStates[requestedKey];
      return nextViewStates;
    });
  }, []);

  const fetchProfilePayload = useCallback(async (args: ProfileTargetArgs) => {
    if (args.handle) {
      const response = await fetch(`/api/user-profiles?handle=${encodeURIComponent(args.handle)}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to load user profile");
      }

      return payload as UserProfilePayload | null;
    }

    const explicitAddress = normalizeAddress(args.address);
    const signerAddress = explicitAddress || await args.signer?.getRecommendedAddress();
    if (!signerAddress) {
      throw new Error("Unable to resolve wallet address");
    }

    const response = await fetch("/api/user-profiles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ address: signerAddress }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error ?? "Failed to load user profile");
    }

    return payload as UserProfilePayload | null;
  }, []);

  const ensureLoaded = useCallback((args: ProfileTargetArgs, force = false) => {
    const requestedKey = buildRequestedProfileKey(args);
    if (!requestedKey) {
      return;
    }

    const resolvedKey = aliasesRef.current[requestedKey] ?? requestedKey;
    const currentEntry = entriesRef.current[resolvedKey] ?? createEmptyProfileEntry();

    if (loadInFlightRef.current.has(resolvedKey)) {
      return;
    }

    if (!force && (currentEntry.isUserProfileLoading || currentEntry.isSavingUserProfile || currentEntry.isSeedingWalletFbars)) {
      return;
    }

    if (!force && currentEntry.hasLoaded && !currentEntry.dirty) {
      return;
    }

    loadInFlightRef.current.add(resolvedKey);
    setEntries((current) => withUpdatedEntry(current, resolvedKey, (entry) => ({
      ...entry,
      isUserProfileLoading: true,
      userProfileError: "",
    })));

    void fetchProfilePayload(args)
      .then((payload) => {
        applyPayload(args, payload);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to load user profile";
        setEntries((current) => withUpdatedEntry(current, resolvedKey, (entry) => ({
          ...entry,
          hasLoaded: true,
          isUserProfileLoading: false,
          userProfileError: message,
        })));
      })
      .finally(() => {
        loadInFlightRef.current.delete(resolvedKey);
      });
  }, [applyPayload, fetchProfilePayload]);

  const resolveMutationAddress = useCallback(async (args: ProfileTargetArgs) => {
    const normalizedAddress = normalizeAddress(args.address);
    if (normalizedAddress) {
      return normalizedAddress;
    }

    const resolvedKey = resolveProfileKey(args);
    const cachedAddress = normalizeAddress(resolvedKey ? entriesRef.current[resolvedKey]?.currentUserProfile?.address : null);
    if (cachedAddress) {
      return cachedAddress;
    }

    const signerAddress = await args.signer?.getRecommendedAddress();
    const normalizedSignerAddress = normalizeAddress(signerAddress);
    if (normalizedSignerAddress) {
      return normalizedSignerAddress;
    }

    throw new Error("Unable to resolve wallet address");
  }, [resolveProfileKey]);

  const saveDisplayName = useCallback(async (args: ProfileTargetArgs, displayName: string) => {
    if (!args.signer) {
      throw new Error("Connect a wallet first");
    }

    setEntryFlags(args, (entry) => ({
      ...entry,
      isSavingUserProfile: true,
      userProfileError: "",
    }));

    try {
      const address = await resolveMutationAddress(args);
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

      applyPayload({ ...args, address }, payload as UserProfilePayload | null);
      return (payload?.profile as UserProfile | null) ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update display name";
      setEntryFlags(args, (entry) => ({
        ...entry,
        isSavingUserProfile: false,
        userProfileError: message,
      }));
      throw error;
    }
  }, [applyPayload, resolveMutationAddress, setEntryFlags]);

  const saveWeeklyMarqueeMessage = useCallback(async (args: ProfileTargetArgs, weeklyMarqueeMessage: string) => {
    if (!args.signer) {
      throw new Error("Connect a wallet first");
    }

    setEntryFlags(args, (entry) => ({
      ...entry,
      isSavingUserProfile: true,
      userProfileError: "",
    }));

    try {
      const address = await resolveMutationAddress(args);
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

      const signature = await args.signer.signMessage(noncePayload.nonce);
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

      applyPayload({ ...args, address }, payload as UserProfilePayload | null);
      return (payload?.profile as UserProfile | null) ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update weekly marquee message";
      setEntryFlags(args, (entry) => ({
        ...entry,
        isSavingUserProfile: false,
        userProfileError: message,
      }));
      throw error;
    }
  }, [applyPayload, resolveMutationAddress, setEntryFlags]);

  const saveLightModePrimaryColor = useCallback(async (args: ProfileTargetArgs, lightModePrimaryColor: LightModePrimaryColor) => {
    if (!args.signer) {
      throw new Error("Connect a wallet first");
    }

    setEntryFlags(args, (entry) => ({
      ...entry,
      isSavingUserProfile: true,
      userProfileError: "",
    }));

    try {
      const address = await resolveMutationAddress(args);
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

      applyPayload({ ...args, address }, payload as UserProfilePayload | null);
      const nextProfile = (payload?.profile as UserProfile | null) ?? null;
      if (nextProfile?.lightModePrimaryColor) {
        persistLightModePrimaryColor(nextProfile.lightModePrimaryColor);
      }
      return nextProfile;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update light mode primary color";
      setEntryFlags(args, (entry) => ({
        ...entry,
        isSavingUserProfile: false,
        userProfileError: message,
      }));
      throw error;
    }
  }, [applyPayload, resolveMutationAddress, setEntryFlags]);

  const seedWalletFbars = useCallback(async (args: ProfileTargetArgs) => {
    if (!args.signer || args.handle) {
      return null;
    }

    setEntryFlags(args, (entry) => ({
      ...entry,
      isSeedingWalletFbars: true,
      userProfileError: "",
    }));

    try {
      const address = await resolveMutationAddress(args);
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

      const signature = await args.signer.signMessage(noncePayload.nonce);
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

      ensureLoaded({ ...args, address }, true);
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to seed wallet FBARS";
      setEntryFlags(args, (entry) => ({
        ...entry,
        isSeedingWalletFbars: false,
        userProfileError: message,
      }));
      throw error;
    } finally {
      setEntryFlags(args, (entry) => ({
        ...entry,
        isSeedingWalletFbars: false,
      }));
    }
  }, [ensureLoaded, resolveMutationAddress, setEntryFlags]);

  const markDirty = useCallback((args: ProfileTargetArgs) => {
    const requestedKey = buildRequestedProfileKey(args);
    if (!requestedKey) {
      return;
    }

    const resolvedKey = aliasesRef.current[requestedKey] ?? requestedKey;
    setEntries((current) => withUpdatedEntry(current, resolvedKey, (entry) => ({
      ...entry,
      dirty: true,
    })));
  }, []);

  const setActiveTab = useCallback((args: ProfileTargetArgs, value: ProfileViewTabKey) => {
    const requestedKey = buildRequestedProfileKey(args);
    if (!requestedKey) {
      return;
    }

    const resolvedKey = aliasesRef.current[requestedKey] ?? requestedKey;
    setViewStates((current) => ({
      ...current,
      [resolvedKey]: {
        ...(current[resolvedKey] ?? createDefaultViewState()),
        activeTab: value,
      },
    }));
  }, []);

  const setCurrentUserProfile = useCallback((args: ProfileTargetArgs, value: UserProfile | null | ((current: UserProfile | null) => UserProfile | null)) => {
    const requestedKey = buildRequestedProfileKey(args);
    if (!requestedKey) {
      return;
    }

    const resolvedKey = aliasesRef.current[requestedKey] ?? requestedKey;
    setEntries((current) => withUpdatedEntry(current, resolvedKey, (entry) => ({
      ...entry,
      currentUserProfile: typeof value === "function" ? value(entry.currentUserProfile) : value,
    })));
  }, []);

  const resetViewerRequest = useCallback(() => {
    loadInFlightRef.current.delete(VIEWER_PROFILE_REQUEST_KEY);

    setEntries((current) => {
      if (!(VIEWER_PROFILE_REQUEST_KEY in current)) {
        return current;
      }

      const nextEntries = { ...current };
      delete nextEntries[VIEWER_PROFILE_REQUEST_KEY];
      return nextEntries;
    });

    setAliases((current) => {
      if (!(VIEWER_PROFILE_REQUEST_KEY in current)) {
        return current;
      }

      const nextAliases = { ...current };
      delete nextAliases[VIEWER_PROFILE_REQUEST_KEY];
      return nextAliases;
    });

    setViewStates((current) => {
      if (!(VIEWER_PROFILE_REQUEST_KEY in current)) {
        return current;
      }

      const nextViewStates = { ...current };
      delete nextViewStates[VIEWER_PROFILE_REQUEST_KEY];
      return nextViewStates;
    });
  }, []);

  const value = useMemo<UserProfileContextValue>(() => ({
    entries,
    ensureLoaded,
    markDirty,
    resetViewerRequest,
    resolveProfileKey,
    saveDisplayName,
    saveLightModePrimaryColor,
    saveWeeklyMarqueeMessage,
    seedWalletFbars,
    setActiveTab,
    setCurrentUserProfile,
    viewStates,
  }), [
    entries,
    ensureLoaded,
    markDirty,
    resetViewerRequest,
    resolveProfileKey,
    saveDisplayName,
    saveLightModePrimaryColor,
    saveWeeklyMarqueeMessage,
    seedWalletFbars,
    setActiveTab,
    setCurrentUserProfile,
    viewStates,
  ]);

  return createElement(UserProfileContext.Provider, { value }, children);
}

export function useUserProfile(signer: ccc.Signer | null, targetHandle?: string | null) {
  const context = useContext(UserProfileContext);
  if (!context) {
    throw new Error("useUserProfile must be used within a UserProfileProvider");
  }

  const targetArgs = useMemo<ProfileTargetArgs>(() => ({
    handle: targetHandle ?? null,
    signer,
  }), [signer, targetHandle]);
  const previousSignerRef = useRef<ccc.Signer | null>(signer);

  useEffect(() => {
    if (targetHandle) {
      return;
    }

    if (previousSignerRef.current !== signer) {
      context.resetViewerRequest();
      previousSignerRef.current = signer;
    }
  }, [context, signer, targetHandle]);

  const resolvedKey = context.resolveProfileKey(targetArgs);
  const entry = resolvedKey ? (context.entries[resolvedKey] ?? createEmptyProfileEntry()) : createEmptyProfileEntry();

  useEffect(() => {
    if (!signer && !targetHandle) {
      return;
    }

    context.ensureLoaded(targetArgs);
  }, [context, signer, targetArgs, targetHandle]);

  useEffect(() => {
    if (targetHandle || !entry.currentUserProfile?.lightModePrimaryColor) {
      return;
    }

    persistLightModePrimaryColor(entry.currentUserProfile.lightModePrimaryColor);
  }, [entry.currentUserProfile?.lightModePrimaryColor, targetHandle]);

  const seedWalletFbars = useCallback(async () => {
    return context.seedWalletFbars(targetArgs);
  }, [context, targetArgs]);

  useEffect(() => {
    if (!signer || targetHandle || entry.isUserProfileLoading || entry.isSeedingWalletFbars) {
      return;
    }

    if (!entry.currentUserProfile) {
      return;
    }

    const address = entry.currentUserProfile.address;

    if (entry.currentUserProfile.hasSeededWalletFbars) {
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
        context.markDirty(targetArgs);
        context.setCurrentUserProfile(targetArgs, (currentProfile) => currentProfile);
        console.error(error);
      })
      .finally(() => {
        finishWalletSeedAttempt(address);
      });
  }, [context, entry.currentUserProfile, entry.isSeedingWalletFbars, entry.isUserProfileLoading, seedWalletFbars, signer, targetArgs, targetHandle]);

  const refreshUserProfile = useCallback(() => {
    if (!signer && !targetHandle) {
      return;
    }

    context.ensureLoaded(targetArgs, true);
  }, [context, signer, targetArgs, targetHandle]);

  const markUserProfileDirty = useCallback((overrideArgs?: { address?: string | null; handle?: string | null }) => {
    context.markDirty({
      address: overrideArgs?.address,
      handle: overrideArgs?.handle ?? targetHandle ?? null,
      signer: overrideArgs?.address || overrideArgs?.handle ? null : signer,
    });
  }, [context, signer, targetHandle]);

  return {
    activeWeeklyMarqueeEditsRemaining: entry.activeWeeklyMarqueeEditsRemaining,
    activeWeeklyMarqueeEditsUsed: entry.activeWeeklyMarqueeEditsUsed,
    activeWeeklyMarqueeMaxEdits: entry.activeWeeklyMarqueeMaxEdits,
    activeWeeklyMarqueeMessage: entry.activeWeeklyMarqueeMessage,
    activeWeeklyMarqueeOwner: entry.activeWeeklyMarqueeOwner,
    activeWeeklyMarqueeWeekKey: entry.activeWeeklyMarqueeWeekKey,
    currentUserProfile: entry.currentUserProfile,
    isSavingUserProfile: entry.isSavingUserProfile,
    isSeedingWalletFbars: entry.isSeedingWalletFbars,
    isUserProfileLoading: entry.isUserProfileLoading,
    leaderboard: entry.leaderboard,
    markUserProfileDirty,
    overallLeaderboard: entry.overallLeaderboard,
    profileCacheKey: resolvedKey ?? buildRequestedProfileKey(targetArgs),
    refreshUserProfile,
    saveDisplayName: (displayName: string) => context.saveDisplayName(targetArgs, displayName),
    saveLightModePrimaryColor: (lightModePrimaryColor: LightModePrimaryColor) => context.saveLightModePrimaryColor(targetArgs, lightModePrimaryColor),
    saveWeeklyMarqueeMessage: (weeklyMarqueeMessage: string) => context.saveWeeklyMarqueeMessage(targetArgs, weeklyMarqueeMessage),
    seedWalletFbars,
    setCurrentUserProfile: (value: UserProfile | null | ((current: UserProfile | null) => UserProfile | null)) => context.setCurrentUserProfile(targetArgs, value),
    userProfileError: entry.userProfileError,
    weeklyLeaderboard: entry.weeklyLeaderboard,
  };
}

export function useProfileViewState(signer: ccc.Signer | null, targetHandle?: string | null) {
  const context = useContext(UserProfileContext);
  if (!context) {
    throw new Error("useProfileViewState must be used within a UserProfileProvider");
  }

  const targetArgs = useMemo<ProfileTargetArgs>(() => ({
    handle: targetHandle ?? null,
    signer,
  }), [signer, targetHandle]);
  const resolvedKey = context.resolveProfileKey(targetArgs) ?? buildRequestedProfileKey(targetArgs);
  const activeTab = resolvedKey ? (context.viewStates[resolvedKey]?.activeTab ?? DEFAULT_PROFILE_TAB) : DEFAULT_PROFILE_TAB;

  return {
    activeTab,
    setActiveTab: (value: ProfileViewTabKey) => context.setActiveTab(targetArgs, value),
  };
}
