"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { Check, CheckCircle, DollarSign, LockKeyhole, Scroll } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import AppShellHeader from "@/app/_components/AppShellHeader";
import CampaignCommentsPanel from "@/app/_components/CampaignCommentsPanel";
import CampaignDetailSurface from "@/app/_components/CampaignDetailSurface";
import CampaignMountablesPanel, { type CampaignMountableItem } from "@/app/_components/CampaignMountablesPanel";
import CreateCampaignHeaderActions from "@/app/_components/CreateCampaignHeaderActions";
import CreateCampaignLauncher from "@/app/_components/CreateCampaignLauncher";
import ThreeDotLoader from "@/app/_components/ThreeDotLoader";
import {
  CREATE_INFO_CONSTRAINT_HEADING,
  CREATE_INFO_CONSTRAINT_ITEMS,
  CREATE_INFO_NOTE_HEADING,
  CREATE_INFO_NOTE_ITEMS,
  CREATE_INFO_PREVIEW_HEADING,
  CREATE_INFO_PREVIEW_ITEMS,
  CREATE_INFO_TYPING_HEADING,
  CREATE_INFO_TYPING_ITEMS,
} from "@/app/_lib/createCampaignInfo";
import {
  appMountableSummary,
  isAppMountableEnabled,
  normalizeAppMountableConfigs,
} from "@/app/_lib/appMountable";
import { formsMountableSummary, isFormsMountableEnabled, normalizeFormsMountableConfig } from "@/app/_lib/formsMountable";
import { canAccessLockMountable, getLockMountableBypassFbars, getLockMountableValidationState, isLockMountableEnabled, lockMountableSummary, parseLockMinimumFbars } from "@/app/_lib/lockMountable";
import { useCreateCampaignFlow } from "@/app/_hooks/useCreateCampaignFlow";
import { useGoogleLink } from "@/app/_hooks/useGoogleLink";
import { useUserProfile } from "@/app/_hooks/useUserProfile";
import { useWalletInfo } from "@/app/_hooks/useWalletInfo";
import type { CampaignRecord } from "@/app/_types/campaignRecords";
import type { FormsMountableConfig } from "@/app/_types/formsMountable";
import { buildDefaultUsername, decodeCreatedByAddress, formatCkbAmount } from "@/lib/campaignDisplay";
import { markWalletSeedIntent } from "@/lib/walletSeed";
import { findCampaignByRecord, normalizeHash } from "@/lib/campaignIdentity";
import { fetchCampaigns, type CampaignCell } from "@/lib/transactions";

function splitCampaignId(campaignId: string) {
  const normalizedCampaignId = normalizeHash(campaignId);
  if (normalizedCampaignId.includes(":")) {
    return { campaignId: normalizedCampaignId, txHash: null, index: null };
  }

  const separator = campaignId.lastIndexOf("-");
  if (separator === -1) {
    return null;
  }

  const txHash = campaignId.slice(0, separator);
  const indexText = campaignId.slice(separator + 1);
  const index = Number.parseInt(indexText, 10);
  if (!txHash || !Number.isInteger(index)) {
    return null;
  }

  return { campaignId: null, txHash, index };
}

function truncateAddress(address: string) {
  if (address.length <= 16) {
    return address;
  }

  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function normalizeAddress(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizeEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function getCurrentPathname() {
  if (typeof window === "undefined") {
    return "/";
  }

  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.delete("google_link_code");
  return `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
}

function formatFormsClaimStatusLabel(status: string) {
  switch (status) {
    case "verified":
      return "Verified";
    case "rejected":
      return "Rejected";
    default:
      return "Pending";
  }
}

type FormsClaimParticipant = {
  mountableType: string | null;
  participantAddress: string;
  participantKind: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  status: "pending" | "verified" | "rejected";
  submittedAt: string | null;
  updatedAt: string | null;
};

function parseFormsClaimParticipant(value: unknown): FormsClaimParticipant | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    mountableType?: unknown;
    participantAddress?: unknown;
    participantKind?: unknown;
    reviewNote?: unknown;
    reviewedAt?: unknown;
    status?: unknown;
    submittedAt?: unknown;
    updatedAt?: unknown;
  };
  const status = typeof candidate.status === "string" ? candidate.status.trim().toLowerCase() : "";
  if (status !== "pending" && status !== "verified" && status !== "rejected") {
    return null;
  }

  const participantAddress = typeof candidate.participantAddress === "string" ? candidate.participantAddress.trim() : "";
  if (!participantAddress) {
    return null;
  }

  return {
    mountableType: typeof candidate.mountableType === "string" ? candidate.mountableType.trim().toLowerCase() : null,
    participantAddress,
    participantKind: typeof candidate.participantKind === "string" ? candidate.participantKind.trim().toLowerCase() : null,
    reviewNote: typeof candidate.reviewNote === "string" ? candidate.reviewNote.trim() : null,
    reviewedAt: typeof candidate.reviewedAt === "string" ? candidate.reviewedAt : null,
    status,
    submittedAt: typeof candidate.submittedAt === "string" ? candidate.submittedAt : null,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : null,
  };
}

const DETAIL_EXPANDING_FLAG = "freight:detail-expanding";
const DETAIL_CONTRACTING_FLAG = "freight:detail-contracting";
const SHELL_TRANSITION_MS = 420;
const DETAIL_CAMPAIGN_FETCH_LIMIT = 200;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TYPE_LABELS = ["Simple Task", "FundedTask", "Crowdfunding", "Timed Challenge", "Raffle"];
const INSUFFICIENT_FBARS_MESSAGE = "Interact more on chain to improve FBARS.";

type InfoModalMode = "about" | "mountables" | "mountables-forms" | "mountables-lock" | "mountables-apps" | "save-draft-confirm" | "submission-success" | "insufficient-fbars";

export default function CampaignDetailPage() {
  const { open, disconnect, client } = ccc.useCcc();
  const openWalletWithSeed = useCallback(() => {
    markWalletSeedIntent();
    open();
  }, [open]);
  const signer = ccc.useSigner();
  const router = useRouter();
  const params = useParams<{ campaignId: string }>();
  const encodedCampaignIdParam = Array.isArray(params.campaignId) ? (params.campaignId[0] ?? "") : (params.campaignId ?? "");
  const rawCampaignIdParam = useMemo(() => {
    try {
      return decodeURIComponent(encodedCampaignIdParam);
    } catch {
      return encodedCampaignIdParam;
    }
  }, [encodedCampaignIdParam]);
  const campaignRef = useMemo(() => splitCampaignId(rawCampaignIdParam), [rawCampaignIdParam]);
  const [selectedRecord, setSelectedRecord] = useState<CampaignRecord | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignCell | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [chainSyncError, setChainSyncError] = useState("");
  const [isChainSyncing, setIsChainSyncing] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [shellWidthClass, setShellWidthClass] = useState("campaign-shell-width");

  const INFO_MODAL_ANIMATION_MS = 620;
  const returnToFeedTimerRef = useRef<number | null>(null);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [isInfoModalClosing, setIsInfoModalClosing] = useState(false);
  const [infoModalMode, setInfoModalMode] = useState<InfoModalMode>("about");
  const [infoModalInteraction, setInfoModalInteraction] = useState<"hover" | "click">("hover");
  const [showWalletInfoModal, setShowWalletInfoModal] = useState(false);
  const [isWalletInfoClosing, setIsWalletInfoClosing] = useState(false);
  const walletInfoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletInfoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerInfoButtonRef = useRef<HTMLButtonElement>(null);
  const infoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    handleCopyWalletAddress,
    walletAddress,
    walletAddressDisplay,
    walletBalance,
    walletBalanceIncreasing,
    walletChainLabel,
    walletCopyFeedback,
    walletInfoError,
    walletInfoLoading,
    walletUsdParts,
  } = useWalletInfo(client, signer ?? null, showWalletInfoModal, true);
  const {
    currentUserProfile,
    isSavingUserProfile,
    saveLightModePrimaryColor,
  } = useUserProfile(signer ?? null);
  const {
    beginGoogleLink,
    googleLinkError,
    hasFormsResponseAccess,
    isGoogleLinked,
    isHydratingGoogleLink,
    isLinkingGoogle,
    isRefreshingLinkedGoogleGrant,
    linkedGoogleAccount,
    linkedGoogleGrant,
    refreshLinkedGoogleGrant,
  } = useGoogleLink(signer ?? null, currentUserProfile);
  const [formsClaims, setFormsClaims] = useState<FormsClaimParticipant[]>([]);
  const [formsClaimsError, setFormsClaimsError] = useState("");
  const [isFormsClaimsLoading, setIsFormsClaimsLoading] = useState(false);
  const [isSubmittingFormsClaim, setIsSubmittingFormsClaim] = useState(false);
  const [isSyncingFormsClaims, setIsSyncingFormsClaims] = useState(false);
  const [isVerifyingFormsAccess, setIsVerifyingFormsAccess] = useState(false);
  const [participantFormsActionError, setParticipantFormsActionError] = useState("");
  const [participantFormsActionNotice, setParticipantFormsActionNotice] = useState("");
  const [creatorFormsActionError, setCreatorFormsActionError] = useState("");
  const [creatorFormsActionNotice, setCreatorFormsActionNotice] = useState("");
  const [activeFormsReviewAddress, setActiveFormsReviewAddress] = useState<string | null>(null);
  const walletActionHref = useMemo(() => {
    const nextUsername = currentUserProfile?.username?.trim() || (walletAddress ? buildDefaultUsername(walletAddress) : "");
    return nextUsername ? `/user/${encodeURIComponent(nextUsername)}` : undefined;
  }, [currentUserProfile?.username, walletAddress]);
  const canEditLightModePrimaryColor = Boolean(signer && walletAddress && currentUserProfile?.address === walletAddress);
  const formsMountableConfig = useMemo<FormsMountableConfig>(
    () => normalizeFormsMountableConfig(selectedRecord?.mountables?.forms ?? null),
    [selectedRecord?.mountables?.forms],
  );
  const mountedFormsUrl = formsMountableConfig.canonicalFormUrl?.trim() || formsMountableConfig.formUrl.trim();
  const mountedFormsId = formsMountableConfig.formId?.trim() ?? "";
  const normalizedWalletAddress = normalizeAddress(walletAddress);
  const normalizedCreatorAddress = normalizeAddress(selectedRecord?.creatorAddress ?? (selectedCampaign ? decodeCreatedByAddress(selectedCampaign) : ""));
  const isCampaignCreator = normalizedWalletAddress.length > 0
    && normalizedCreatorAddress.length > 0
    && normalizedWalletAddress === normalizedCreatorAddress;
  const linkedIdentityEmail = linkedGoogleAccount?.email?.trim() ?? "";
  const linkedGrantDisplayEmail = linkedGoogleGrant?.email?.trim() ?? "";
  const normalizedLinkedGrantEmail = normalizeEmail(linkedGoogleGrant?.email ?? null);
  const normalizedVerifiedGrantEmail = normalizeEmail(formsMountableConfig.responseAccessEmail ?? null);
  const hasVerifiedFormsResponseAccess = formsMountableConfig.responseAccessStatus === "verified"
    && Boolean(formsMountableConfig.responseAccessVerifiedAt?.trim())
    && normalizedVerifiedGrantEmail.length > 0;
  const linkedGrantDiffersFromVerifiedAccess = normalizedLinkedGrantEmail.length > 0
    && normalizedVerifiedGrantEmail.length > 0
    && normalizedLinkedGrantEmail !== normalizedVerifiedGrantEmail;

  const recordLookupQuery = useMemo(() => {
    const nextLookupQuery = !campaignRef
      ? `campaignId=${encodeURIComponent(rawCampaignIdParam)}`
      : campaignRef.campaignId
        ? `campaignId=${encodeURIComponent(campaignRef.campaignId)}`
        : campaignRef.txHash
          ? `txHash=${encodeURIComponent(campaignRef.txHash)}`
          : `campaignId=${encodeURIComponent(rawCampaignIdParam)}`;

    console.log("[campaign detail] lookup params", {
      encodedCampaignIdParam,
      rawCampaignIdParam,
      campaignRef,
      recordLookupQuery: nextLookupQuery,
    });

    return nextLookupQuery;
  }, [campaignRef, encodedCampaignIdParam, rawCampaignIdParam]);

  const clearInfoCloseTimer = useCallback(() => {
    if (infoCloseTimerRef.current) {
      clearTimeout(infoCloseTimerRef.current);
      infoCloseTimerRef.current = null;
    }
  }, []);

  const clearInfoHideTimer = useCallback(() => {
    if (infoHideTimerRef.current) {
      clearTimeout(infoHideTimerRef.current);
      infoHideTimerRef.current = null;
    }
  }, []);

  const closeInfoModal = useCallback((onBeforeHide?: () => void) => {
    clearInfoCloseTimer();
    if (!showInfoModal || isInfoModalClosing) {
      return;
    }

    setIsInfoModalClosing(true);
    clearInfoHideTimer();
    infoHideTimerRef.current = setTimeout(() => {
      onBeforeHide?.();
      setShowInfoModal(false);
      setIsInfoModalClosing(false);
      setInfoModalInteraction("hover");
      infoHideTimerRef.current = null;
    }, INFO_MODAL_ANIMATION_MS);
  }, [clearInfoCloseTimer, clearInfoHideTimer, isInfoModalClosing, showInfoModal]);

  const openInfoModalFromHover = useCallback((preventHoverOpen: boolean = false) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();

    if (preventHoverOpen) {
      return;
    }

    if (showInfoModal && infoModalInteraction === "click" && !isInfoModalClosing) {
      return;
    }

    setInfoModalMode("about");
    setInfoModalInteraction("hover");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearInfoCloseTimer, clearInfoHideTimer, infoModalInteraction, isInfoModalClosing, showInfoModal]);

  const keepInfoModalOpen = useCallback(() => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearInfoCloseTimer, clearInfoHideTimer]);

  const scheduleCloseInfoModal = useCallback((preventAutoClose: boolean = false, onBeforeHide?: () => void) => {
    if (preventAutoClose) {
      return;
    }

    clearInfoCloseTimer();
    infoCloseTimerRef.current = setTimeout(() => {
      closeInfoModal(onBeforeHide);
    }, 120);
  }, [clearInfoCloseTimer, closeInfoModal]);

  const clearWalletInfoCloseTimer = useCallback(() => {
    if (walletInfoCloseTimerRef.current) {
      clearTimeout(walletInfoCloseTimerRef.current);
      walletInfoCloseTimerRef.current = null;
    }
  }, []);

  const clearWalletInfoHideTimer = useCallback(() => {
    if (walletInfoHideTimerRef.current) {
      clearTimeout(walletInfoHideTimerRef.current);
      walletInfoHideTimerRef.current = null;
    }
  }, []);

  const keepWalletInfoModalOpen = useCallback(() => {
    clearWalletInfoCloseTimer();
    clearWalletInfoHideTimer();
    setIsWalletInfoClosing(false);
    setShowWalletInfoModal(true);
  }, [clearWalletInfoCloseTimer, clearWalletInfoHideTimer]);

  const closeWalletInfoModal = useCallback(() => {
    clearWalletInfoCloseTimer();
    if (!showWalletInfoModal || isWalletInfoClosing) {
      return;
    }

    setIsWalletInfoClosing(true);
    clearWalletInfoHideTimer();
    walletInfoHideTimerRef.current = setTimeout(() => {
      setShowWalletInfoModal(false);
      setIsWalletInfoClosing(false);
      walletInfoHideTimerRef.current = null;
    }, 220);
  }, [clearWalletInfoCloseTimer, clearWalletInfoHideTimer, isWalletInfoClosing, showWalletInfoModal]);

  const scheduleWalletInfoModalClose = useCallback(() => {
    clearWalletInfoCloseTimer();
    walletInfoCloseTimerRef.current = setTimeout(() => {
      closeWalletInfoModal();
    }, 250);
  }, [clearWalletInfoCloseTimer, closeWalletInfoModal]);

  const {
    constraintStatus,
    createModalContentRef,
    createModalStep,
    createResetSignal,
    createStepBackSignal,
    finalizeCloseCreateModal,
    formsMountableSelected,
    lockMountableSelected,
    handleCreateTopRightAction,
    handleDraftSelectionRequest,
    handleSaveDraftChoice,
    isCreateDraftListOpen,
    isCreateModalClosing,
    isMountableFormFocused,
    isMountableLockFocused,
    isMountablesContinuing,
    mountableFormLinks,
    mountableLockFbars,
    mountableFormValidationState,
    mountableLockValidationState,
    mountablesPromptError,
    openCreateModal,
    openMountablesModal,
    openSubmissionSuccessInfoModal,
    previewError,
    requestCloseCreateModal,
    resetCreateInfoModalState,
    resetCreateModal,
    saveDraftPromptError,
    setConstraintStatus,
    setCreateModalStep,
    setFormsMountableSelected,
    setLockMountableSelected,
    setIsCreateDraftListOpen,
    setIsMountableFormFocused,
    setIsMountableLockFocused,
    setIsMountablesContinuing,
    setMountableFormLinks,
    setMountableLockFbars,
    setMountableFormValidationState,
    setMountableLockValidationState,
    setMountablesPromptError,
    setPreviewError,
    showCreateModal,
    submissionSuccessTxHash,
    transitionMountablesModal,
  } = useCreateCampaignFlow<InfoModalMode>({
    animationMs: INFO_MODAL_ANIMATION_MS,
    initialInfoModalMode: "about",
    openWallet: openWalletWithSeed,
    signer,
    clearInfoCloseTimer,
    clearInfoHideTimer,
    closeInfoModal,
    setInfoModalMode,
    setInfoModalInteraction,
    setIsInfoModalClosing,
    setShowInfoModal,
  });

  const resetInfoModalState = useCallback(() => {
    resetCreateInfoModalState();
  }, [resetCreateInfoModalState]);

  const openInsufficientFbarsInfoModal = useCallback(() => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    setInfoModalMode("insufficient-fbars");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
    infoCloseTimerRef.current = setTimeout(() => {
      closeInfoModal(resetInfoModalState);
    }, 3000);
  }, [
    clearInfoCloseTimer,
    clearInfoHideTimer,
    closeInfoModal,
    resetInfoModalState,
    setInfoModalInteraction,
    setIsInfoModalClosing,
    setShowInfoModal,
  ]);

  const preventInfoHover = infoModalMode === "save-draft-confirm"
    || infoModalMode === "mountables"
    || infoModalMode === "mountables-lock"
    || infoModalMode === "mountables-forms"
    || infoModalMode === "submission-success";

  useLayoutEffect(() => {
    const isExpandingFromFeed = sessionStorage.getItem(DETAIL_EXPANDING_FLAG) === "1";
    sessionStorage.removeItem(DETAIL_EXPANDING_FLAG);

    if (!isExpandingFromFeed) {
      setShellWidthClass("campaign-shell-width-md");
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      setShellWidthClass("campaign-shell-width-md");
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  const handleReturnToFeed = useCallback((event?: { preventDefault: () => void }) => {
    event?.preventDefault();
    if (returnToFeedTimerRef.current !== null) {
      return;
    }

    sessionStorage.removeItem(DETAIL_EXPANDING_FLAG);
    sessionStorage.setItem(DETAIL_CONTRACTING_FLAG, "1");
    setShellWidthClass("campaign-shell-width");
    returnToFeedTimerRef.current = window.setTimeout(() => {
      router.push("/");
      returnToFeedTimerRef.current = null;
    }, SHELL_TRANSITION_MS);
  }, [router]);


  useEffect(() => {
    return () => {
      if (returnToFeedTimerRef.current !== null) {
        window.clearTimeout(returnToFeedTimerRef.current);
        returnToFeedTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (signer) {
      return;
    }

    setShowWalletInfoModal(false);
    setIsWalletInfoClosing(false);
    clearWalletInfoCloseTimer();
    clearWalletInfoHideTimer();
  }, [clearWalletInfoCloseTimer, clearWalletInfoHideTimer, signer]);

  useEffect(() => {
    return () => {
      clearWalletInfoCloseTimer();
      clearWalletInfoHideTimer();
    };
  }, [clearWalletInfoCloseTimer, clearWalletInfoHideTimer]);

  useEffect(() => {
    if (infoModalMode !== "mountables-forms") {
      return;
    }

    const primaryLink = mountableFormLinks[mountableFormLinks.length - 1]?.trim() ?? "";
    if (!primaryLink) {
      setMountableFormValidationState("idle");
      setMountablesPromptError("");
      return;
    }

    let cancelled = false;
    setMountableFormValidationState("validating");
    setMountablesPromptError("");

    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const validationResponse = await fetch("/api/google-forms/validate", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ formUrl: primaryLink }),
          });
          const validationPayload = await validationResponse.json().catch(() => null);
          if (cancelled) {
            return;
          }

          if (!validationResponse.ok) {
            setIsMountableFormFocused(false);
            setMountableFormValidationState("invalid");
            setMountablesPromptError(validationPayload?.error ?? "Failed to validate Google Form");
            return;
          }

          setIsMountableFormFocused(false);
          setMountableFormValidationState("valid");
          setMountablesPromptError("");
        } catch (error) {
          if (cancelled) {
            return;
          }

          setIsMountableFormFocused(false);
          setMountableFormValidationState("invalid");
          setMountablesPromptError(error instanceof Error ? error.message : "Failed to validate Google Form");
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [infoModalMode, mountableFormLinks, setIsMountableFormFocused, setMountableFormValidationState, setMountablesPromptError]);

  useEffect(() => {
    if (infoModalMode !== "mountables-lock") {
      return;
    }

    const nextValidationState = getLockMountableValidationState(mountableLockFbars, currentUserProfile?.fbars);
    setMountableLockValidationState(nextValidationState);
    if (nextValidationState !== "idle") {
      setIsMountableLockFocused(false);
    }

    const parsedLockFbars = parseLockMinimumFbars(mountableLockFbars);
    if (nextValidationState === "invalid") {
      if (
        parsedLockFbars !== null
        && typeof currentUserProfile?.fbars === "number"
        && Number.isFinite(currentUserProfile.fbars)
        && parsedLockFbars > Math.trunc(currentUserProfile.fbars)
      ) {
        setMountablesPromptError(`Lock cannot exceed your ${Math.trunc(currentUserProfile.fbars)} FBARS.`);
      } else {
        setMountablesPromptError("Enter a positive FBARS amount.");
      }
      return;
    }

    setMountablesPromptError("");
  }, [currentUserProfile?.fbars, infoModalMode, mountableLockFbars, setIsMountableLockFocused, setMountableLockValidationState, setMountablesPromptError]);

  useEffect(() => {
    let cancelled = false;

    if (!recordLookupQuery) {
      console.log("[campaign detail] skipping backend record lookup because query is empty", {
        encodedCampaignIdParam,
        rawCampaignIdParam,
        campaignRef,
      });
      setSelectedRecord(null);
      setSelectedCampaign(null);
      setChainSyncError("");
      setIsChainSyncing(false);
      setError("");
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    console.log("[campaign detail] starting backend record lookup", {
      encodedCampaignIdParam,
      rawCampaignIdParam,
      campaignRef,
      recordLookupQuery,
      requestUrl: `/api/campaign-records?${recordLookupQuery}`,
    });

    void (async () => {
      try {
        setLoading(true);
        setError("");
        setSelectedRecord(null);
        setSelectedCampaign(null);
        setChainSyncError("");
        setIsChainSyncing(false);

        const response = await fetch(`/api/campaign-records?${recordLookupQuery}`, { cache: "no-store" });
        const payload = await response.json().catch(() => null);

        console.log("[campaign detail] backend record lookup response", {
          ok: response.ok,
          status: response.status,
          recordLookupQuery,
          payload,
        });

        if (!response.ok) {
          throw new Error(payload?.error ?? "Failed to fetch campaign record");
        }

        if (!cancelled) {
          const nextRecord = payload?.record && typeof payload.record === "object" ? payload.record as CampaignRecord : null;
          console.log("[campaign detail] selected backend record", nextRecord);
          setSelectedRecord(nextRecord);
        }
      } catch (loadError) {
        console.log("[campaign detail] backend record lookup failed", loadError);
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load campaign detail");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [campaignRef, encodedCampaignIdParam, rawCampaignIdParam, recordLookupQuery]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedRecord) {
      console.log("[campaign detail] skipping chain hydration because no backend record is selected yet");
      setSelectedCampaign(null);
      setChainSyncError("");
      setIsChainSyncing(false);
      return () => {
        cancelled = true;
      };
    }

    console.log("[campaign detail] starting chain hydration", {
      selectedRecord,
      fetchLimit: DETAIL_CAMPAIGN_FETCH_LIMIT,
    });

    void (async () => {
      try {
        setIsChainSyncing(true);
        setChainSyncError("");
        setSelectedCampaign(null);

        const chainCampaigns = await fetchCampaigns(client, DETAIL_CAMPAIGN_FETCH_LIMIT);
        if (cancelled) {
          return;
        }

        const matchedCampaign = findCampaignByRecord(chainCampaigns, selectedRecord);
        console.log("[campaign detail] chain hydration result", {
          hydratedCampaignCount: chainCampaigns.length,
          matchedCampaign,
          selectedRecord,
        });

        setSelectedCampaign(matchedCampaign);
      } catch (loadError) {
        console.log("[campaign detail] chain hydration failed", loadError);
        if (!cancelled) {
          setChainSyncError(loadError instanceof Error ? loadError.message : "Failed to sync live chain data");
        }
      } finally {
        if (!cancelled) {
          setIsChainSyncing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, selectedRecord]);

  const createSignedWalletAction = useCallback(async (purpose: string) => {
    if (!signer) {
      openWalletWithSeed();
      throw new Error("Connect a wallet first");
    }

    const address = await signer.getRecommendedAddress();
    if (!address) {
      throw new Error("Unable to resolve wallet address");
    }

    const nonceResponse = await fetch("/api/wallet/nonce", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ address, purpose }),
    });
    const noncePayload = await nonceResponse.json().catch(() => null) as {
      error?: string;
      nonce?: string;
    } | null;
    if (!nonceResponse.ok || typeof noncePayload?.nonce !== "string") {
      throw new Error(noncePayload?.error ?? `Failed to create ${purpose} nonce`);
    }

    const signature = await signer.signMessage(noncePayload.nonce);
    return {
      address,
      nonce: noncePayload.nonce,
      nonceSignature: {
        signature: signature.signature,
        identity: signature.identity,
        signType: signature.signType,
      },
    };
  }, [openWalletWithSeed, signer]);

  const loadFormsClaims = useCallback(async () => {
    const campaignId = selectedRecord?.campaignId?.trim().toLowerCase() ?? "";
    if (!formsMountableConfig.enabled || !campaignId) {
      setFormsClaims([]);
      setFormsClaimsError("");
      setIsFormsClaimsLoading(false);
      return;
    }

    setIsFormsClaimsLoading(true);
    setFormsClaimsError("");

    try {
      const response = await fetch(`/api/campaign-participants?campaignId=${encodeURIComponent(campaignId)}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
        participants?: unknown[];
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to fetch forms claims");
      }

      const nextClaims = Array.isArray(payload?.participants)
        ? payload.participants
            .map(parseFormsClaimParticipant)
            .filter((claim): claim is FormsClaimParticipant => Boolean(claim && claim.mountableType === "forms" && claim.participantKind === "forms_claim"))
        : [];
      setFormsClaims(nextClaims);
    } catch (loadError) {
      setFormsClaims([]);
      setFormsClaimsError(loadError instanceof Error ? loadError.message : "Failed to fetch forms claims");
    } finally {
      setIsFormsClaimsLoading(false);
    }
  }, [formsMountableConfig.enabled, selectedRecord?.campaignId]);

  useEffect(() => {
    if (!formsMountableConfig.enabled) {
      setFormsClaims([]);
      setFormsClaimsError("");
      setIsFormsClaimsLoading(false);
      return;
    }

    void loadFormsClaims();
  }, [formsMountableConfig.enabled, loadFormsClaims]);

  const currentWalletFormsClaim = useMemo(
    () => formsClaims.find((claim) => normalizeAddress(claim.participantAddress) === normalizedWalletAddress) ?? null,
    [formsClaims, normalizedWalletAddress],
  );
  const pendingFormsClaims = useMemo(
    () => formsClaims.filter((claim) => claim.status === "pending"),
    [formsClaims],
  );
  const verifiedFormsClaims = useMemo(
    () => formsClaims.filter((claim) => claim.status === "verified"),
    [formsClaims],
  );
  const isGoogleLinkBusy = isHydratingGoogleLink || isLinkingGoogle;
  const isFormsGrantBusy = isGoogleLinkBusy || isRefreshingLinkedGoogleGrant || isVerifyingFormsAccess;

  const handleBeginGoogleAccountLink = useCallback(async (purpose: "identity_link" | "forms_response_access") => {
    if (!signer) {
      openWalletWithSeed();
      return;
    }

    if (purpose === "forms_response_access" && !mountedFormsId) {
      setCreatorFormsActionError("Mounted Google Form is missing a valid form id.");
      return;
    }

    if (purpose === "forms_response_access") {
      setCreatorFormsActionError("");
      setCreatorFormsActionNotice("");
    } else {
      setParticipantFormsActionError("");
      setParticipantFormsActionNotice("");
    }

    try {
      await beginGoogleLink(getCurrentPathname(), purpose);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to link Google";
      if (purpose === "forms_response_access") {
        setCreatorFormsActionError(message);
      } else {
        setParticipantFormsActionError(message);
      }
    }
  }, [beginGoogleLink, mountedFormsId, openWalletWithSeed, signer]);

  const handleRefreshFormsGrant = useCallback(async () => {
    if (!signer) {
      openWalletWithSeed();
      return;
    }

    setCreatorFormsActionError("");
    setCreatorFormsActionNotice("");

    try {
      await refreshLinkedGoogleGrant();
      setCreatorFormsActionNotice("Google response-access grant refreshed.");
    } catch (error) {
      setCreatorFormsActionError(error instanceof Error ? error.message : "Failed to refresh linked Google access");
    }
  }, [openWalletWithSeed, refreshLinkedGoogleGrant, signer]);

  const handleVerifyFormsResponseAccess = useCallback(async () => {
    if (!signer) {
      openWalletWithSeed();
      return;
    }

    if (!mountedFormsId) {
      setCreatorFormsActionError("Mounted Google Form is missing a valid form id.");
      return;
    }

    setIsVerifyingFormsAccess(true);
    setCreatorFormsActionError("");
    setCreatorFormsActionNotice("");

    try {
      const signed = await createSignedWalletAction("google-forms-access");
      const accessResponse = await fetch("/api/google-forms/access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: signed.address,
          formId: mountedFormsId,
          nonce: signed.nonce,
          nonceSignature: signed.nonceSignature,
        }),
      });
      const accessPayload = await accessResponse.json().catch(() => null) as {
        access?: {
          grantEmail?: string;
          verifiedAt?: string;
        } | null;
        error?: string;
      } | null;
      if (!accessResponse.ok || !accessPayload?.access) {
        throw new Error(accessPayload?.error ?? "Failed to verify Google Forms response access");
      }

      const nextFormsMountable = normalizeFormsMountableConfig({
        ...formsMountableConfig,
        verificationMode: "google_forms_api",
        responseAccessEmail: accessPayload.access?.grantEmail ?? "",
        responseAccessStatus: "verified",
        responseAccessVerifiedAt: accessPayload.access?.verifiedAt ?? "",
      });

      setSelectedRecord((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          mountables: {
            ...current.mountables,
            forms: nextFormsMountable,
          },
        };
      });

      if (selectedRecord?._id) {
        const persistResponse = await fetch(`/api/campaign-records/${selectedRecord._id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: selectedRecord.title ?? "",
            description: selectedRecord.description ?? "",
            campaignId: selectedRecord.campaignId ?? null,
            createdByHash: selectedRecord.createdByHash ?? null,
            chainCreatedAt: selectedRecord.chainCreatedAt ?? null,
            campaignType: selectedRecord.campaignType ?? 0,
            summaryDraft: selectedRecord.summaryDraft ?? "",
            argsDraft: {
              taskStartDelayHours: selectedRecord.argsDraft?.taskStartDelayHours ?? "0",
              taskDurationHours: selectedRecord.argsDraft?.taskDurationHours ?? "0",
              maxAmountCkb: selectedRecord.argsDraft?.maxAmountCkb ?? "0",
              auxAmountCkb: selectedRecord.argsDraft?.auxAmountCkb ?? "0",
              rewardCount: selectedRecord.argsDraft?.rewardCount ?? "0",
            },
            mountables: {
              ...selectedRecord.mountables,
              forms: nextFormsMountable,
            },
            socialMetadata: selectedRecord.socialMetadata ?? {},
            giftDeliverable: selectedRecord.giftDeliverable ?? null,
            creatorAddress: selectedRecord.creatorAddress ?? null,
            creatorHandle: selectedRecord.creatorHandle ?? null,
            status: selectedRecord.status ?? "published",
            txHash: selectedRecord.txHash ?? null,
            publishError: selectedRecord.publishError ?? null,
            randomnessPreimage: selectedRecord.randomnessPreimage ?? null,
            activatedTxHash: selectedRecord.activatedTxHash ?? null,
            activatedAt: selectedRecord.activatedAt ?? null,
            activatedByAddress: selectedRecord.activatedByAddress ?? null,
            settlementTxHash: selectedRecord.settlementTxHash ?? null,
            settledAt: selectedRecord.settledAt ?? null,
            settledByAddress: selectedRecord.settledByAddress ?? null,
            soldTicketCount: selectedRecord.soldTicketCount ?? null,
            settledParticipantCount: selectedRecord.settledParticipantCount ?? null,
            settledRecipients: selectedRecord.settledRecipients ?? null,
          }),
        });
        const persistPayload = await persistResponse.json().catch(() => null) as {
          error?: string;
        } | null;
        if (!persistResponse.ok) {
          throw new Error(persistPayload?.error ?? "Failed to save Google Forms access state");
        }
      }

      await refreshLinkedGoogleGrant().catch(() => undefined);
      setCreatorFormsActionNotice(accessPayload.access?.grantEmail
        ? `Verified response access with ${accessPayload.access.grantEmail}.`
        : "Verified Google Forms response access.");
    } catch (error) {
      setCreatorFormsActionError(error instanceof Error ? error.message : "Failed to verify Google Forms response access");
    } finally {
      setIsVerifyingFormsAccess(false);
    }
  }, [createSignedWalletAction, formsMountableConfig, mountedFormsId, openWalletWithSeed, refreshLinkedGoogleGrant, signer]);

  const handleSubmitFormsClaim = useCallback(async () => {
    if (!signer) {
      openWalletWithSeed();
      return;
    }

    if (!selectedRecord?._id) {
      setParticipantFormsActionError("This freight is missing a record id for forms verification.");
      return;
    }

    setIsSubmittingFormsClaim(true);
    setParticipantFormsActionError("");
    setParticipantFormsActionNotice("");

    try {
      const signed = await createSignedWalletAction("forms-claim");
      const response = await fetch(`/api/campaign-records/${selectedRecord._id}/forms/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: signed.address,
          nonce: signed.nonce,
          nonceSignature: signed.nonceSignature,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
        googleEmail?: string;
        matchFound?: boolean;
        status?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to verify forms claim");
      }

      await loadFormsClaims();
      if (payload?.status === "verified") {
        setParticipantFormsActionNotice(payload.googleEmail
          ? `Verified submission for ${payload.googleEmail}.`
          : "Verified your Google Forms submission.");
      } else if (payload?.matchFound) {
        setParticipantFormsActionNotice("A matching response was found for this form.");
      } else {
        setParticipantFormsActionNotice(linkedIdentityEmail
          ? `No matching response yet. Submit the form with ${linkedIdentityEmail} and try again.`
          : "No matching response yet. Submit the form with your linked Google account and try again.");
      }
    } catch (error) {
      setParticipantFormsActionError(error instanceof Error ? error.message : "Failed to verify forms claim");
    } finally {
      setIsSubmittingFormsClaim(false);
    }
  }, [createSignedWalletAction, linkedIdentityEmail, loadFormsClaims, openWalletWithSeed, selectedRecord?._id, signer]);

  const handleSyncFormsClaims = useCallback(async () => {
    if (!signer) {
      openWalletWithSeed();
      return;
    }

    if (!selectedRecord?._id) {
      setCreatorFormsActionError("This freight is missing a record id for forms verification.");
      return;
    }

    setIsSyncingFormsClaims(true);
    setCreatorFormsActionError("");
    setCreatorFormsActionNotice("");

    try {
      const signed = await createSignedWalletAction("forms-sync");
      const response = await fetch(`/api/campaign-records/${selectedRecord._id}/forms/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: signed.address,
          nonce: signed.nonce,
          nonceSignature: signed.nonceSignature,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        checkedCount?: number;
        error?: string;
        verifiedCount?: number;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to sync forms claims");
      }

      await loadFormsClaims();
      const checkedCount = typeof payload?.checkedCount === "number" ? payload.checkedCount : 0;
      const verifiedCount = typeof payload?.verifiedCount === "number" ? payload.verifiedCount : 0;
      setCreatorFormsActionNotice(
        checkedCount === 0
          ? "No pending forms claims to sync."
          : verifiedCount > 0
            ? `Checked ${checkedCount} pending claim(s); verified ${verifiedCount}.`
            : `Checked ${checkedCount} pending claim(s); no new matches yet.`
      );
    } catch (error) {
      setCreatorFormsActionError(error instanceof Error ? error.message : "Failed to sync forms claims");
    } finally {
      setIsSyncingFormsClaims(false);
    }
  }, [createSignedWalletAction, loadFormsClaims, openWalletWithSeed, selectedRecord?._id, signer]);

  const handleReviewFormsClaim = useCallback(async (participantAddress: string, status: "verified" | "rejected") => {
    if (!signer) {
      openWalletWithSeed();
      return;
    }

    const campaignId = selectedRecord?.campaignId?.trim();
    if (!campaignId) {
      setCreatorFormsActionError("This freight is missing a stable campaign id for review.");
      return;
    }

    const normalizedParticipantAddress = normalizeAddress(participantAddress);
    if (!normalizedParticipantAddress) {
      setCreatorFormsActionError("Participant address is required for review.");
      return;
    }

    setActiveFormsReviewAddress(normalizedParticipantAddress);
    setCreatorFormsActionError("");
    setCreatorFormsActionNotice("");

    try {
      const signed = await createSignedWalletAction("forms-review");
      const response = await fetch(`/api/campaign-participants/${encodeURIComponent(campaignId)}/review`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          participantAddress: normalizedParticipantAddress,
          reviewedByAddress: signed.address,
          status,
          nonce: signed.nonce,
          nonceSignature: signed.nonceSignature,
        }),
      });
      const payload = await response.json().catch(() => null) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to review forms claim");
      }

      await loadFormsClaims();
      setCreatorFormsActionNotice(`${status === "verified" ? "Marked" : "Rejected"} claim for ${truncateAddress(normalizedParticipantAddress)}.`);
    } catch (error) {
      setCreatorFormsActionError(error instanceof Error ? error.message : "Failed to review forms claim");
    } finally {
      setActiveFormsReviewAddress(null);
    }
  }, [createSignedWalletAction, loadFormsClaims, openWalletWithSeed, selectedRecord?.campaignId, signer]);

  const comments = useMemo(() => (
    Array.isArray(selectedRecord?.socialMetadata?.comments)
      ? selectedRecord.socialMetadata.comments.filter((value): value is { text: string; creatorAddress?: string | null; creatorHandle?: string | null; createdAt?: string } => (
        !!value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string"
      ))
      : []
  ), [selectedRecord?.socialMetadata?.comments]);

  const formsMountableActions = useMemo(() => {
    if (!formsMountableConfig.enabled) {
      return null;
    }

    const participantErrorMessage = participantFormsActionError || (!isCampaignCreator ? googleLinkError : "");
    const creatorErrorMessage = creatorFormsActionError || (isCampaignCreator ? googleLinkError : "");
    const currentClaimUpdatedAt = currentWalletFormsClaim?.updatedAt ?? currentWalletFormsClaim?.submittedAt ?? null;
    const creatorReady = hasVerifiedFormsResponseAccess && !linkedGrantDiffersFromVerifiedAccess;

    if (!signer) {
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-gray-600">
            Connect a wallet to link Google and verify this mounted form.
          </p>
          <p className="text-xs text-gray-500">
            {mountedFormsUrl
              ? "After connecting, open the Google Form, submit it, then return here to verify your response."
              : "After connecting, link Google first, then verify your response here."}
          </p>
        </div>
      );
    }

    if (isCampaignCreator) {
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-600">
            {creatorReady
              ? "Automatic verification is ready. Participant responses will be matched against respondentEmail."
              : !hasFormsResponseAccess
                ? "Link the Google account that can read this form's responses."
                : !hasVerifiedFormsResponseAccess
                  ? "Verify that the linked Google account can read this form before syncing claims."
                  : "The linked Google account changed after verification. Verify access again before syncing claims."}
          </p>
          {linkedGrantDisplayEmail ? (
            <p className="text-xs text-gray-500">Linked Google: {linkedGrantDisplayEmail}</p>
          ) : null}
          {formsMountableConfig.responseAccessVerifiedAt?.trim() ? (
            <p className="text-xs text-gray-500">
              Verified at {new Date(formsMountableConfig.responseAccessVerifiedAt.trim()).toLocaleString()}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2 text-xs text-gray-500">
            <span>{pendingFormsClaims.length} pending</span>
            <span>{verifiedFormsClaims.length} verified</span>
          </div>
          {creatorFormsActionNotice ? (
            <p className="text-xs text-green-600">{creatorFormsActionNotice}</p>
          ) : null}
          {creatorErrorMessage ? (
            <p className="text-xs text-red-500">{creatorErrorMessage}</p>
          ) : null}
          {formsClaimsError ? (
            <p className="text-xs text-red-500">{formsClaimsError}</p>
          ) : null}
          <div className="create-info-confirm-actions create-info-confirm-actions-tight">
            <button
              type="button"
              className="create-info-confirm-btn"
              onClick={() => void handleBeginGoogleAccountLink("forms_response_access")}
              disabled={isFormsGrantBusy || !mountedFormsId}
            >
              {isGoogleLinkBusy ? "Linking..." : hasFormsResponseAccess ? "Relink Google" : "Link Google"}
            </button>
            <button
              type="button"
              className="create-info-confirm-btn"
              onClick={() => void handleRefreshFormsGrant()}
              disabled={!hasFormsResponseAccess || isFormsGrantBusy}
            >
              {isRefreshingLinkedGoogleGrant ? "Refreshing..." : "Refresh"}
            </button>
            <button
              type="button"
              className="create-info-confirm-btn create-info-confirm-btn-primary"
              onClick={() => void handleVerifyFormsResponseAccess()}
              disabled={!hasFormsResponseAccess || !mountedFormsId || isFormsGrantBusy}
            >
              {isVerifyingFormsAccess ? "Verifying..." : creatorReady ? "Verified" : "Verify access"}
            </button>
          </div>
          <div className="create-info-confirm-actions create-info-confirm-actions-tight">
            <button
              type="button"
              className="create-info-confirm-btn"
              onClick={() => void loadFormsClaims()}
              disabled={isFormsClaimsLoading}
            >
              {isFormsClaimsLoading ? "Loading..." : "Reload claims"}
            </button>
            <button
              type="button"
              className="create-info-confirm-btn create-info-confirm-btn-primary"
              onClick={() => void handleSyncFormsClaims()}
              disabled={!creatorReady || !selectedRecord?._id || isSyncingFormsClaims}
            >
              {isSyncingFormsClaims ? "Syncing..." : pendingFormsClaims.length > 0 ? "Sync pending" : "Sync claims"}
            </button>
          </div>
          {formsClaims.length > 0 ? (
            <div className="flex flex-col gap-2">
              {formsClaims.map((claim) => {
                const claimAddress = normalizeAddress(claim.participantAddress);
                const isReviewingThisClaim = activeFormsReviewAddress === claimAddress;
                const statusToneClassName = claim.status === "verified"
                  ? "text-green-600 border-green-200 bg-green-50"
                  : claim.status === "rejected"
                    ? "text-red-500 border-red-200 bg-red-50"
                    : "text-amber-700 border-amber-200 bg-amber-50";

                return (
                  <div key={`${claimAddress}-${claim.submittedAt ?? claim.updatedAt ?? claim.status}`} className="rounded border border-gray-200 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono text-xs text-gray-600">{truncateAddress(claim.participantAddress)}</span>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusToneClassName}`.trim()}>
                        {formatFormsClaimStatusLabel(claim.status)}
                      </span>
                    </div>
                    {claim.submittedAt ? (
                      <p className="mt-1 text-[11px] text-gray-500">Submitted {new Date(claim.submittedAt).toLocaleString()}</p>
                    ) : null}
                    {claim.reviewedAt ? (
                      <p className="mt-1 text-[11px] text-gray-500">Reviewed {new Date(claim.reviewedAt).toLocaleString()}</p>
                    ) : null}
                    {claim.reviewNote ? (
                      <p className="mt-1 text-[11px] text-gray-500">Review note: {claim.reviewNote}</p>
                    ) : null}
                    {claim.status === "pending" ? (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          className="create-info-confirm-btn create-info-confirm-btn-primary"
                          onClick={() => void handleReviewFormsClaim(claim.participantAddress, "verified")}
                          disabled={Boolean(activeFormsReviewAddress) || isReviewingThisClaim}
                        >
                          {isReviewingThisClaim ? "Working..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          className="create-info-confirm-btn"
                          onClick={() => void handleReviewFormsClaim(claim.participantAddress, "rejected")}
                          disabled={Boolean(activeFormsReviewAddress) || isReviewingThisClaim}
                        >
                          Reject
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              {isFormsClaimsLoading ? "Loading forms claims..." : "No forms claims yet."}
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-600">
          {!isGoogleLinked
            ? "Link your Google account once, then submit the form with that same email."
            : currentWalletFormsClaim?.status === "verified"
              ? "Your submission has already been verified automatically."
              : currentWalletFormsClaim?.status === "rejected"
                ? "This claim was rejected. Re-submit if needed, then verify again."
                : currentWalletFormsClaim?.status === "pending"
                  ? "Your claim is pending. Re-check after submitting the form or after the creator syncs new responses."
                  : linkedIdentityEmail
                    ? `Submit the form with ${linkedIdentityEmail}, then verify your submission here.`
                    : "Submit the form with your linked Google account, then verify your submission here."}
        </p>
        {linkedIdentityEmail ? (
          <p className="text-xs text-gray-500">Linked Google: {linkedIdentityEmail}</p>
        ) : null}
        {currentWalletFormsClaim ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span className="font-medium text-gray-700">Status: {formatFormsClaimStatusLabel(currentWalletFormsClaim.status)}</span>
            {currentClaimUpdatedAt ? <span>Updated {new Date(currentClaimUpdatedAt).toLocaleString()}</span> : null}
          </div>
        ) : null}
        {currentWalletFormsClaim?.reviewNote ? (
          <p className="text-xs text-gray-500">Review note: {currentWalletFormsClaim.reviewNote}</p>
        ) : null}
        {participantFormsActionNotice ? (
          <p className="text-xs text-green-600">{participantFormsActionNotice}</p>
        ) : null}
        {participantErrorMessage ? (
          <p className="text-xs text-red-500">{participantErrorMessage}</p>
        ) : null}
        {formsClaimsError ? (
          <p className="text-xs text-red-500">{formsClaimsError}</p>
        ) : null}
        <div className="create-info-confirm-actions create-info-confirm-actions-tight">
          <button
            type="button"
            className="create-info-confirm-btn"
            onClick={() => void handleBeginGoogleAccountLink("identity_link")}
            disabled={isGoogleLinkBusy}
          >
            {isGoogleLinkBusy ? "Linking..." : isGoogleLinked ? "Relink Google" : "Link Google"}
          </button>
          <button
            type="button"
            className="create-info-confirm-btn create-info-confirm-btn-primary"
            onClick={() => void handleSubmitFormsClaim()}
            disabled={!isGoogleLinked || !selectedRecord?._id || !mountedFormsId || isSubmittingFormsClaim}
          >
            {isSubmittingFormsClaim ? "Checking..." : currentWalletFormsClaim?.status === "verified" ? "Verified" : currentWalletFormsClaim?.status === "pending" ? "Recheck submission" : "Verify submission"}
          </button>
        </div>
      </div>
    );
  }, [
    activeFormsReviewAddress,
    creatorFormsActionError,
    creatorFormsActionNotice,
    currentWalletFormsClaim,
    formsClaims,
    formsClaimsError,
    formsMountableConfig,
    googleLinkError,
    handleBeginGoogleAccountLink,
    handleRefreshFormsGrant,
    handleReviewFormsClaim,
    handleSubmitFormsClaim,
    handleSyncFormsClaims,
    handleVerifyFormsResponseAccess,
    hasFormsResponseAccess,
    hasVerifiedFormsResponseAccess,
    isCampaignCreator,
    isFormsClaimsLoading,
    isFormsGrantBusy,
    isGoogleLinkBusy,
    isGoogleLinked,
    isRefreshingLinkedGoogleGrant,
    isSubmittingFormsClaim,
    isSyncingFormsClaims,
    isVerifyingFormsAccess,
    linkedGrantDiffersFromVerifiedAccess,
    linkedGrantDisplayEmail,
    linkedIdentityEmail,
    loadFormsClaims,
    mountedFormsId,
    mountedFormsUrl,
    participantFormsActionError,
    participantFormsActionNotice,
    pendingFormsClaims.length,
    selectedRecord?._id,
    signer,
    verifiedFormsClaims.length,
  ]);

  const mountableItems = useMemo<CampaignMountableItem[]>(() => {
    const items: CampaignMountableItem[] = [];
    const formsMountable = selectedRecord?.mountables?.forms;
    const lockMountable = selectedRecord?.mountables?.lock;

    if (formsMountable && isFormsMountableEnabled(formsMountable)) {
      const metadata = [
        formsMountable.formId ? `Form ID ${formsMountable.formId}` : "",
        formsMountable.validatedAt ? `Validated ${new Date(formsMountable.validatedAt).toLocaleDateString()}` : "",
        formsMountable.responseAccessStatus === "verified" && formsMountable.responseAccessVerifiedAt
          ? `Access verified ${new Date(formsMountable.responseAccessVerifiedAt).toLocaleDateString()}`
          : "",
      ].filter(Boolean);

      items.push({
        actions: formsMountableActions,
        description: formsMountableSummary(formsMountable),
        href: formsMountable.canonicalFormUrl || formsMountable.formUrl || undefined,
        icon: "forms",
        key: "forms",
        metadata,
        proofInstructions: formsMountable.proofInstructions?.trim() || undefined,
        title: "Forms",
      });
    }

    if (lockMountable && isLockMountableEnabled(lockMountable)) {
      items.push({
        description: lockMountableSummary(lockMountable),
        icon: "lock",
        key: "lock",
        metadata: ["Criterion: FBARS"],
        title: "Lock",
      });
    }

    return items;
  }, [formsMountableActions, selectedRecord?.mountables?.forms, selectedRecord?.mountables?.lock]);

  const commentsLocked = !canAccessLockMountable(selectedRecord?.mountables?.lock, currentUserProfile?.fbars);
  const commentsLockBypassFbars = getLockMountableBypassFbars(selectedRecord?.mountables?.lock);
  const detailCampaignType = selectedCampaign?.data.campaignType ?? selectedRecord?.campaignType ?? 0;
  const detailTypeLabel = TYPE_LABELS[detailCampaignType] ?? `Type ${detailCampaignType}`;
  const detailUsesRaffleRandomness = detailCampaignType === 4;
  const detailRewardCountValue = selectedCampaign
    ? Number(selectedCampaign.data.rewardCount)
    : Number.parseInt(selectedRecord?.argsDraft?.rewardCount ?? "0", 10);
  const detailTicketPriceText = selectedCampaign
    ? (selectedCampaign.data.auxAmount > 0n ? `${formatCkbAmount(selectedCampaign.data.auxAmount)} CKB` : "")
    : (selectedRecord?.argsDraft?.auxAmountCkb?.trim() ? `${selectedRecord.argsDraft.auxAmountCkb.trim()} CKB` : "");

  const headerBody = (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">Freight details</p>
      <p className="create-info-constraint-item text-gray-500">
        <span>Type: {detailTypeLabel}</span>
      </p>
      {detailUsesRaffleRandomness ? (
        <>
          <p className="mt-3 create-review-section-label text-gray-900">Randomness</p>
          <p className="create-info-constraint-item text-gray-500">
            <span>Yes — this freight is a raffle, so settlement uses committed randomness.</span>
          </p>
          {detailTicketPriceText ? (
            <p className="create-info-constraint-item text-gray-500">
              <span>Ticket price: {detailTicketPriceText}</span>
            </p>
          ) : null}
          {Number.isFinite(detailRewardCountValue) && detailRewardCountValue > 0 ? (
            <p className="create-info-constraint-item text-gray-500">
              <span>Winners selected: {detailRewardCountValue}</span>
            </p>
          ) : null}
          <p className="create-info-constraint-item text-gray-500">
            <span>How it works: a 32-byte randomness hash is committed up front, then the revealed preimage is combined with this freight&apos;s tx hash, output index, and participant count to deterministically shuffle entrants before taking the winner set.</span>
          </p>
        </>
      ) : (
        <>
          <p className="mt-3 create-review-section-label text-gray-900">Randomness</p>
          <p className="create-info-constraint-item text-gray-500">
            <span>No — this freight type does not use raffle randomness.</span>
          </p>
        </>
      )}
    </div>
  );

  const infoModalBody = infoModalMode === "submission-success" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label" style={{ color: "#16a34a" }}>Submission successful</p>
      <p className="create-info-constraint-item text-gray-500 font-mono break-all">txhash:
        <a
          href={`https://pudge.explorer.nervos.org/transaction/${submissionSuccessTxHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {submissionSuccessTxHash}
        </a>
      </p>
    </div>
  ) : infoModalMode === "insufficient-fbars" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">Not enough FBARS</p>
      <p className="create-info-constraint-item text-gray-500 break-words">
        <span>{INSUFFICIENT_FBARS_MESSAGE}</span>
      </p>
    </div>
  ) : showCreateModal && infoModalMode === "save-draft-confirm" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">Save draft?</p>
      {saveDraftPromptError ? (
        <p className="create-info-constraint-item text-red-500">
          <span>{saveDraftPromptError}</span>
        </p>
      ) : null}
    </div>
  ) : showCreateModal && infoModalMode === "mountables" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">Mountables:</p>
      <div className="create-mountable-options-row">
        <button
          type="button"
          className={`create-mountable-option ${formsMountableSelected ? "create-mountable-option-selected" : ""}`}
          aria-label={formsMountableSelected ? "Deselect forms mountable" : "Select forms mountable"}
          aria-pressed={formsMountableSelected}
          data-tooltip="Forms"
          onClick={() => {
            const nextSelected = !formsMountableSelected;
            createModalContentRef.current?.setFormsMountableEnabled(nextSelected);
            setFormsMountableSelected(nextSelected);
            setMountableFormLinks((current) => current.length > 0 ? current : [""]);
            setMountablesPromptError("");
          }}
        >
          <span className="create-mountable-option-icon-wrap">
            <span className="create-mountable-option-icon-bg">
              <Scroll size={18} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="create-mountable-option-check" aria-hidden="true">
              <Check size={12} strokeWidth={2.6} aria-hidden="true" />
            </span>
          </span>
        </button>
        <button
          type="button"
          className="create-mountable-option"
          data-tooltip="Payable"
          disabled
          aria-label="Payable mountable coming soon"
        >
          <span className="create-mountable-option-icon-wrap">
            <span className="create-mountable-option-icon-bg">
              <DollarSign size={18} strokeWidth={2} aria-hidden="true" />
            </span>
          </span>
        </button>
        <button
          type="button"
          className={`create-mountable-option ${lockMountableSelected ? "create-mountable-option-selected" : ""}`}
          aria-label={lockMountableSelected ? "Deselect lock mountable" : "Select lock mountable"}
          aria-pressed={lockMountableSelected}
          data-tooltip="Lock"
          onClick={() => {
            const nextSelected = !lockMountableSelected;
            createModalContentRef.current?.setLockMountableEnabled(nextSelected);
            setLockMountableSelected(nextSelected);
            setMountableLockFbars((current) => current || createModalContentRef.current?.getLockMountableConfig().minimumFbars || "");
            setMountablesPromptError("");
          }}
        >
          <span className="create-mountable-option-icon-wrap">
            <span className="create-mountable-option-icon-bg">
              <LockKeyhole size={18} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="create-mountable-option-check" aria-hidden="true">
              <Check size={12} strokeWidth={2.6} aria-hidden="true" />
            </span>
          </span>
        </button>
      </div>
      {mountablesPromptError ? (
        <p className="create-info-constraint-item text-red-500 mt-3">
          <span>{mountablesPromptError}</span>
        </p>
      ) : null}
    </div>
  ) : showCreateModal && infoModalMode === "mountables-lock" ? (
    <div className="create-info-constraints-copy">
      <div className="create-info-forms-config create-info-forms-config-tight">
        <div className="create-review-card-heading-row">
          <p className="create-review-section-label text-gray-900">Lock criteria:</p>
          {mountablesPromptError ? <p className="create-info-forms-inline-error">{mountablesPromptError}</p> : null}
        </div>
        <div className="create-info-forms-row flex items-center gap-2">
          <span className="create-review-section-label text-gray-900">With:</span>
          <div className="create-info-ticket-input-wrap">
            <input
              type="text"
              inputMode="numeric"
              value={mountableLockFbars}
              onChange={(event) => {
                const nextValue = event.target.value;
                setMountableLockFbars(nextValue);
                createModalContentRef.current?.updateLockMountableConfig({ minimumFbars: nextValue });
                setMountablesPromptError("");
              }}
              onFocus={() => {
                if (mountableLockValidationState === "idle") {
                  setIsMountableLockFocused(true);
                }
              }}
              onBlur={() => setIsMountableLockFocused(false)}
              placeholder="0"
              className={`create-info-ticket-input create-info-ticket-input-with-suffix ${mountableLockValidationState === "invalid" ? "create-info-ticket-input-invalid" : mountableLockValidationState === "valid" ? "create-info-ticket-input-valid" : isMountableLockFocused ? "create-info-ticket-input-focused" : ""}`.trim()}
              aria-label="Lock FBARS threshold"
            />
            <span className="create-info-ticket-input-suffix">FBARS</span>
          </div>
        </div>
      </div>
    </div>
  ) : showCreateModal && infoModalMode === "mountables-forms" ? (
    <div className="create-info-constraints-copy">
      <div className="create-info-forms-config">
        <div className="create-review-card-heading-row">
          <p className="create-review-section-label text-gray-900">Forms (*For now you can only mount one form):</p>
          {mountablesPromptError ? <p className="create-info-forms-inline-error">{mountablesPromptError}</p> : null}
        </div>
        {mountableFormLinks.map((value, index) => (
          <div key={`forms-link-${index}`} className="create-info-forms-row">
            <input
              type="text"
              value={value}
              onChange={(event) => {
                const nextValue = event.target.value;
                setMountableFormLinks((current) => current.map((entry, entryIndex) => entryIndex === index ? nextValue : entry));
                createModalContentRef.current?.updateFormsMountableConfig({ formUrl: nextValue });
                setMountableFormValidationState(nextValue.trim() ? "validating" : "idle");
                setMountablesPromptError("");
              }}
              onFocus={() => {
                if (mountableFormValidationState === "idle") {
                  setIsMountableFormFocused(true);
                }
              }}
              onBlur={() => setIsMountableFormFocused(false)}
              placeholder="Paste Google Forms responder link"
              className={`create-info-ticket-input ${mountableFormValidationState === "invalid" ? "create-info-ticket-input-invalid" : mountableFormValidationState === "valid" ? "create-info-ticket-input-valid" : isMountableFormFocused ? "create-info-ticket-input-focused" : ""}`.trim()}
              aria-label={`Forms link ${index + 1}`}
            />
          </div>
        ))}
      </div>
    </div>
  ) : showCreateModal ? (
    <div className="create-info-constraints-copy">
      {createModalStep === "review" ? (
        <>
          <p>{CREATE_INFO_PREVIEW_HEADING}</p>
          {CREATE_INFO_PREVIEW_ITEMS.map((item) => (
            <p key={item} className="create-info-constraint-item">
              <span>{item}</span>
            </p>
          ))}
          {previewError ? (
            <>
              <p className="mt-3 text-red-500 font-semibold">Errors</p>
              <p className="create-info-constraint-item text-red-500">
                <span>{previewError}</span>
              </p>
            </>
          ) : null}
        </>
      ) : (
        <>
          <p>{CREATE_INFO_CONSTRAINT_HEADING}</p>
          {CREATE_INFO_CONSTRAINT_ITEMS.map((item) => {
            const passed = constraintStatus[item.key];

            return (
              <p
                key={item.key}
                className={`create-info-constraint-item ${passed ? "create-info-constraint-item-pass" : ""}`}
              >
                {passed ? (
                  <span className="create-info-constraint-check" aria-hidden="true">
                    <CheckCircle size={14} strokeWidth={2.4} />
                  </span>
                ) : null}
                <span>{item.text}</span>
              </p>
            );
          })}
          <p className="mt-3 font-semibold" style={{ color: "#961cac" }}>{CREATE_INFO_NOTE_HEADING}</p>
          {CREATE_INFO_NOTE_ITEMS.map((item) => (
            <p key={item} className="create-info-constraint-item" style={{ color: "#961cac" }}>
              <span>{item}</span>
            </p>
          ))}
          <p className="mt-3">{CREATE_INFO_TYPING_HEADING}</p>
          {CREATE_INFO_TYPING_ITEMS.map((item) => (
            <p key={item} className="create-info-constraint-item">
              <span>{item}</span>
            </p>
          ))}
          {!signer ? <p className="mt-3 text-yellow-600 font-semibold">Info: Wallet not connected.</p> : null}
        </>
      )}
    </div>
  ) : headerBody;

  const infoModalActions = showCreateModal && infoModalMode === "save-draft-confirm" ? (
    <div className="create-info-confirm-actions">
      <button
        type="button"
        className="create-info-confirm-btn"
        onClick={() => void handleSaveDraftChoice(false)}
      >
        No
      </button>
      <button
        type="button"
        className="create-info-confirm-btn create-info-confirm-btn-primary"
        onClick={() => void handleSaveDraftChoice(true)}
      >
        Yes
      </button>
    </div>
  ) : showCreateModal && infoModalMode === "mountables" ? (
    <div className="create-info-confirm-actions">
      <button
        type="button"
        className="create-info-confirm-btn create-info-confirm-btn-primary"
        onClick={() => {
          if (!formsMountableSelected && !lockMountableSelected) {
            setMountablesPromptError("Select a mountable to continue.");
            return;
          }

          transitionMountablesModal(lockMountableSelected ? "mountables-lock" : "mountables-forms");
          setMountablesPromptError("");
        }}
      >
        Continue
      </button>
    </div>
  ) : showCreateModal && infoModalMode === "mountables-lock" ? (
    <div className="create-info-confirm-actions create-info-confirm-actions-tight">
      <button
        type="button"
        className="create-info-confirm-btn create-info-confirm-btn-primary"
        disabled={isMountablesContinuing || mountableLockValidationState !== "valid"}
        onClick={() => {
          void (async () => {
            try {
              const minimumFbars = parseLockMinimumFbars(mountableLockFbars);
              if (minimumFbars === null) {
                setMountablesPromptError("Enter a positive FBARS amount.");
                return;
              }

              createModalContentRef.current?.updateLockMountableConfig({ minimumFbars: String(minimumFbars) });

              if (formsMountableSelected) {
                transitionMountablesModal("mountables-forms");
                setMountablesPromptError("");
                return;
              }

              setIsMountablesContinuing(true);
              setMountablesPromptError("");
              await createModalContentRef.current?.persistCurrentDraft();

              closeInfoModal(() => {
                setInfoModalMode("about");
                setMountablesPromptError("");
              });
              void createModalContentRef.current?.advanceToReviewAfterMountableSelection();
            } catch (error) {
              setMountablesPromptError(error instanceof Error ? error.message : "Failed to save the mounted lock");
            } finally {
              setIsMountablesContinuing(false);
            }
          })();
        }}
      >
        {isMountablesContinuing ? "Hold..." : "Continue"}
      </button>
    </div>
  ) : showCreateModal && infoModalMode === "mountables-forms" ? (
    <div className="create-info-confirm-actions create-info-confirm-actions-tight">
      <button
        type="button"
        className="create-info-confirm-btn create-info-confirm-btn-primary"
        disabled={isMountablesContinuing || mountableFormValidationState !== "valid"}
        onClick={() => {
          void (async () => {
            try {
              const primaryLink = mountableFormLinks[mountableFormLinks.length - 1]?.trim() ?? "";
              if (!primaryLink) {
                setMountablesPromptError("Paste a Google Forms responder link to continue.");
                return;
              }

              setIsMountablesContinuing(true);
              setMountablesPromptError("");

              const validationResponse = await fetch("/api/google-forms/validate", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ formUrl: primaryLink }),
              });
              const validationPayload = await validationResponse.json().catch(() => null);
              if (!validationResponse.ok) {
                throw new Error(validationPayload?.error ?? "Failed to validate Google Form");
              }

              const canonicalFormUrl = typeof validationPayload?.canonicalFormUrl === "string" ? validationPayload.canonicalFormUrl : primaryLink;
              const formId = typeof validationPayload?.formId === "string" ? validationPayload.formId : "";
              const validatedAt = typeof validationPayload?.validatedAt === "string" ? validationPayload.validatedAt : "";

              createModalContentRef.current?.updateFormsMountableConfig({
                formUrl: canonicalFormUrl,
                canonicalFormUrl,
                formId,
                validatedAt,
              });
              setMountableFormLinks([canonicalFormUrl]);
              await createModalContentRef.current?.persistCurrentDraft();

              closeInfoModal(() => {
                setInfoModalMode("about");
                setMountablesPromptError("");
              });
              void createModalContentRef.current?.advanceToReviewAfterMountableSelection();
            } catch (error) {
              setMountablesPromptError(error instanceof Error ? error.message : "Failed to save the mounted Google Form");
            } finally {
              setIsMountablesContinuing(false);
            }
          })();
        }}
      >
        {isMountablesContinuing ? "Hold..." : mountableFormValidationState === "validating" ? "Validating..." : "Continue"}
      </button>
    </div>
  ) : undefined;

  const detailContent = (() => {
    if (loading) {
      console.log("[campaign detail] rendering loading state", {
        recordLookupQuery,
        selectedRecord,
        selectedCampaign,
      });
      return <ThreeDotLoader className="campaign-detail-status campaign-card-entry" label="Loading freight details" />;
    }

    if (error) {
      console.log("[campaign detail] rendering error state", {
        error,
        recordLookupQuery,
        selectedRecord,
        selectedCampaign,
      });
      return (
        <div className="campaign-detail-status campaign-card-entry">
          <p className="text-sm text-gray-400">{error}</p>
        </div>
      );
    }

    if (!selectedRecord) {
      console.log("[campaign detail] rendering not-found state", {
        encodedCampaignIdParam,
        rawCampaignIdParam,
        campaignRef,
        recordLookupQuery,
        selectedRecord,
      });
      return (
        <div className="campaign-detail-status campaign-card-entry">
          <p className="text-sm text-gray-400">Campaign not found.</p>
        </div>
      );
    }

    const creatorAddress = selectedRecord.creatorAddress?.trim()
      || selectedRecord.createdByHash?.trim()
      || (selectedCampaign ? decodeCreatedByAddress(selectedCampaign) : ZERO_ADDRESS);

    return (
      <div className="campaign-detail-content">
        <section
          className="campaign-detail-post-column campaign-card-entry"
          style={{ "--campaign-card-enter-delay": "0ms" } as CSSProperties}
        >
          <div className="campaign-detail-column-scroll campaign-detail-column-scroll-left">
            <div className="campaign-detail-card-shell">
              <CampaignDetailSurface
                campaign={selectedCampaign}
                chainSyncError={chainSyncError}
                isChainSyncing={isChainSyncing}
                nowMs={nowMs}
                record={selectedRecord}
              />
            </div>
            <CampaignCommentsPanel
              comments={comments}
              fallbackAddress={creatorAddress}
              locked={commentsLocked}
              lockedMessage={commentsLockBypassFbars === null ? "Comments are locked by mounted criteria." : `Need ${commentsLockBypassFbars} FBARS to bypass this lock and view comments.`}
              variant="inline"
            />
          </div>
        </section>

        <section
          className="campaign-detail-comments-column campaign-card-entry"
          style={{ "--campaign-card-enter-delay": "110ms" } as CSSProperties}
        >
          <div className="campaign-detail-column-scroll campaign-detail-column-scroll-right">
            <CampaignMountablesPanel items={mountableItems} />
          </div>
        </section>
      </div>
    );
  })();

  return (
    <main className="campaign-detail-page">
      <div className={`campaign-detail-shell ${shellWidthClass}`.trim()}>
        <AppShellHeader
          className={`campaign-shell-header ${shellWidthClass} ${showCreateModal ? "campaign-shell-header-transparent" : ""} fixed top-0 left-4 right-4 z-[70] mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`.trim()}
          infoButtonAriaLabel="Open Freight information"
          infoModalAriaLabel={infoModalMode === "insufficient-fbars" ? "Not enough FBARS" : "Freight information modal"}
          infoModalBackdropAriaLabel={infoModalMode === "save-draft-confirm" ? "Return to create freight modal" : "Close Freight information modal"}
          infoModalBackdropInteractive={infoModalInteraction === "click" || infoModalMode === "save-draft-confirm" || infoModalMode === "submission-success"}
          infoModalBody={infoModalBody}
          infoModalActions={infoModalActions}
          infoModalClosing={isInfoModalClosing}
          infoModalOpen={showInfoModal}
          isConnected={Boolean(signer)}
          onConnect={openWalletWithSeed}
          onCopyWalletAddress={() => void handleCopyWalletAddress()}
          onDisconnect={disconnect}
          onInfoButtonBlur={() => scheduleCloseInfoModal(preventInfoHover, resetInfoModalState)}
          onInfoButtonClick={() => handleReturnToFeed()}
          onInfoButtonFocus={() => openInfoModalFromHover(preventInfoHover)}
          onInfoModalKeepOpen={keepInfoModalOpen}
          onInfoModalRequestClose={() => closeInfoModal(resetInfoModalState)}
          onInfoModalScheduleClose={() => scheduleCloseInfoModal(preventInfoHover, resetInfoModalState)}
          onInfoMouseEnter={() => openInfoModalFromHover(preventInfoHover)}
          onInfoMouseLeave={() => scheduleCloseInfoModal(preventInfoHover, resetInfoModalState)}
          onRightActionsClick={(event) => event.stopPropagation()}
          onWalletActionClick={closeWalletInfoModal}
          onWalletMouseEnter={keepWalletInfoModalOpen}
          onWalletMouseLeave={scheduleWalletInfoModalClose}
          rightActions={showCreateModal ? (
            <CreateCampaignHeaderActions
              createModalStep={createModalStep}
              isCreateDraftListOpen={isCreateDraftListOpen}
              isCreateModalClosing={isCreateModalClosing}
              onReset={resetCreateModal}
              onSecondaryAction={handleCreateTopRightAction}
            />
          ) : undefined}
          canEditLightModePrimaryColor={canEditLightModePrimaryColor}
          currentLightModePrimaryColor={currentUserProfile?.lightModePrimaryColor ?? null}
          isSavingLightModePrimaryColor={isSavingUserProfile}
          onSaveLightModePrimaryColor={saveLightModePrimaryColor}
          walletAddress={walletAddress}
          walletAddressDisplay={walletAddressDisplay}
          walletBalanceIncreasing={walletBalanceIncreasing}
          walletBalanceText={walletBalance !== null ? `${formatCkbAmount(walletBalance)} CKB` : walletInfoLoading ? "Loading…" : "--"}
          walletChainLabel={walletChainLabel}
          walletCopyFeedback={walletCopyFeedback}
          walletInfoButtonRef={headerInfoButtonRef}
          walletInfoError={walletInfoError}
          walletModalClosing={isWalletInfoClosing}
          walletModalOpen={showWalletInfoModal}
          walletUsdParts={walletUsdParts}
          walletActionHref={walletActionHref}
        />

        <div className="campaign-detail-content-shell">
          {detailContent}
        </div>

        <CreateCampaignLauncher
          createModalContentRef={createModalContentRef}
          createResetSignal={createResetSignal}
          createStepBackSignal={createStepBackSignal}
          onConstraintStatusChange={setConstraintStatus}
          onDraftListOpenChange={setIsCreateDraftListOpen}
          onDraftSelectionRequest={handleDraftSelectionRequest}
          onInsufficientFbars={openInsufficientFbarsInfoModal}
          onMountableSelectionRequired={openMountablesModal}
          onMountableSelectionStateChange={({ formsSelected, lockSelected }) => {
            setFormsMountableSelected(formsSelected);
            setLockMountableSelected(lockSelected);
          }}
          onOpenCreateModal={openCreateModal}
          onPreviewErrorChange={setPreviewError}
          onPublishSuccess={(txHash) => {
            finalizeCloseCreateModal();
            openSubmissionSuccessInfoModal(txHash);
          }}
          onRequestCloseCreateModal={requestCloseCreateModal}
          onStepChange={setCreateModalStep}
          showCreateModal={showCreateModal}
          isCreateModalClosing={isCreateModalClosing}
          availableFbars={currentUserProfile?.fbars}
        />
      </div>
    </main>
  );
}
