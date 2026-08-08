"use client";

import {
  ArrowUp,
  Check,
  CheckCircle,
  Copy,
  DollarSign,
  LockKeyhole,
  Pencil,
  Scroll,
  Search,
  Trophy,
} from "lucide-react";
import { ccc } from "@ckb-ccc/connector-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import AppShellHeader from "@/app/_components/AppShellHeader";
import CreateCampaignHeaderActions from "@/app/_components/CreateCampaignHeaderActions";
import CreateCampaignLauncher from "@/app/_components/CreateCampaignLauncher";
import ProfileAnalyticsSection from "@/app/_components/ProfileAnalyticsSection";
import ProfileFreightsSection from "@/app/_components/ProfileFreightsSection";
import ProfileTransactionsSection from "@/app/_components/ProfileTransactionsSection";
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
import { getLockMountableValidationState, parseLockMinimumFbars } from "@/app/_lib/lockMountable";
import { useCreateCampaignFlow } from "@/app/_hooks/useCreateCampaignFlow";
import { useInfoModalState } from "@/app/_hooks/useInfoModalState";
import { useProfileAnalytics } from "@/app/_hooks/useProfileAnalytics";
import { useProfileFreights } from "@/app/_hooks/useProfileFreights";
import { useProfileTransactions } from "@/app/_hooks/useProfileTransactions";
import { formatAdsfUsdParts, useUserProfile } from "@/app/_hooks/useUserProfile";
import { useWalletInfo } from "@/app/_hooks/useWalletInfo";
import { formatCkbAmount } from "@/lib/campaignDisplay";
import { markWalletSeedIntent } from "@/lib/walletSeed";

const INFO_MODAL_ANIMATION_MS = 620;
const PROFILE_HERO_REVEAL_STEP_MS = 110;
const PROFILE_HERO_REVEAL_ITEM_COUNT = 3;
const PROFILE_INFO_FBARS_HEADING = "FBARS:";
const PROFILE_INFO_FBARS_MESSAGE = "Calculcation and Minting Coming Soon.";
const PROFILE_INFO_ADSF_HEADING = "ADSF:";
const PROFILE_INFO_ADSF_MESSAGE = "Amount Docked So Far";
const INSUFFICIENT_FBARS_MESSAGE = "Interact more on chain to improve FBARS.";

type InfoModalMode = "about" | "edit-display-name" | "mountables" | "mountables-forms" | "mountables-lock" | "save-draft-confirm" | "submission-success" | "submission-error" | "insufficient-fbars";
type ProfileTabKey = "activity" | "freights" | "transactions";

const PROFILE_TABS: Array<{ key: ProfileTabKey; label: string }> = [
  { key: "activity", label: "Activity" },
  { key: "freights", label: "Freights" },
  { key: "transactions", label: "Transactions" },
];

type ProfileScreenProps = {
  targetHandle?: string | null;
};

export default function ProfileScreen({ targetHandle = null }: ProfileScreenProps) {
  const { open, disconnect, client } = ccc.useCcc();
  const openWalletWithSeed = useCallback(() => {
    markWalletSeedIntent();
    open();
  }, [open]);
  const signer = ccc.useSigner();
  const router = useRouter();
  const headerInfoButtonRef = useRef<HTMLButtonElement>(null);
  const walletInfoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletInfoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [infoModalMode, setInfoModalMode] = useState<InfoModalMode>("about");
  const [showWalletInfoModal, setShowWalletInfoModal] = useState(false);
  const [isWalletInfoClosing, setIsWalletInfoClosing] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [displayNameModalError, setDisplayNameModalError] = useState("");
  const [submissionErrorMessage, setSubmissionErrorMessage] = useState("");
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [isLeaderboardClosing, setIsLeaderboardClosing] = useState(false);
  const [leaderboardScope, setLeaderboardScope] = useState<"weekly" | "overall">("weekly");
  const [activeTab, setActiveTab] = useState<ProfileTabKey>("activity");
  const [revealedProfileHeroCount, setRevealedProfileHeroCount] = useState(0);

  const resetInfoModalStateRef = useRef<() => void>(() => undefined);

  const runResetInfoModalState = useCallback(() => {
    resetInfoModalStateRef.current();
  }, []);

  const {
    clearInfoCloseTimer,
    clearInfoHideTimer,
    clearSubmissionSuccessTimer,
    closeInfoModal,
    infoModalInteraction,
    isInfoModalClosing,
    openInfoModalFromHover,
    scheduleCloseInfoModal,
    setInfoModalInteraction,
    setIsInfoModalClosing,
    setShowInfoModal,
    showInfoModal,
    submissionSuccessTimerRef,
    keepInfoModalOpen,
  } = useInfoModalState({
    animationMs: INFO_MODAL_ANIMATION_MS,
    onResetState: runResetInfoModalState,
  });

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
    isUserProfileLoading,
    overallLeaderboard,
    saveDisplayName,
    saveLightModePrimaryColor,
    userProfileError,
    weeklyLeaderboard,
  } = useUserProfile(signer ?? null, targetHandle);
  const profileAddress = currentUserProfile?.address ?? (targetHandle ? null : (walletAddress || null));

  const {
    analytics: profileAnalytics,
    error: profileAnalyticsError,
    isLoading: isProfileAnalyticsLoading,
  } = useProfileAnalytics({
    address: profileAddress,
    handle: profileAddress ? null : targetHandle,
  });
  const {
    error: profileFreightsError,
    hasLoaded: hasLoadedProfileFreights,
    isLoading: isProfileFreightsLoading,
    isRefreshing: isProfileFreightsRefreshing,
    refresh: refreshProfileFreights,
    rows: profileFreightRows,
  } = useProfileFreights({
    address: profileAddress,
    handle: profileAddress ? null : targetHandle,
  });
  const {
    coverage: profileTransactionsCoverage,
    error: profileTransactionsError,
    hasLoaded: hasLoadedProfileTransactions,
    isLoading: isProfileTransactionsLoading,
    isRefreshing: isProfileTransactionsRefreshing,
    refresh: refreshProfileTransactions,
    rows: profileTransactionRows,
  } = useProfileTransactions({
    address: profileAddress,
    handle: profileAddress ? null : targetHandle,
  });
  const adsfUsdParts = formatAdsfUsdParts(currentUserProfile?.adsfUsdCents);

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
    clearSubmissionSuccessTimer,
    closeInfoModal,
    setInfoModalMode,
    setInfoModalInteraction,
    setIsInfoModalClosing,
    setShowInfoModal,
  });

  const resetInfoModalState = useCallback(() => {
    resetCreateInfoModalState();
    setDisplayNameDraft("");
    setDisplayNameModalError("");
    setSubmissionErrorMessage("");
  }, [resetCreateInfoModalState]);

  const openInsufficientFbarsInfoModal = useCallback(() => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer();
    setInfoModalMode("insufficient-fbars");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
    submissionSuccessTimerRef.current = setTimeout(() => {
      closeInfoModal(resetInfoModalState);
    }, 3000);
  }, [
    clearInfoCloseTimer,
    clearInfoHideTimer,
    clearSubmissionSuccessTimer,
    closeInfoModal,
    resetInfoModalState,
    setInfoModalInteraction,
    setIsInfoModalClosing,
    setShowInfoModal,
    submissionSuccessTimerRef,
  ]);

  resetInfoModalStateRef.current = resetInfoModalState;

  const closeLeaderboardModal = useCallback(() => {
    if (!showLeaderboardModal || isLeaderboardClosing) {
      return;
    }

    setIsLeaderboardClosing(true);
    window.setTimeout(() => {
      setShowLeaderboardModal(false);
      setIsLeaderboardClosing(false);
    }, INFO_MODAL_ANIMATION_MS);
  }, [isLeaderboardClosing, showLeaderboardModal]);

  const openLeaderboardModal = useCallback(() => {
    setLeaderboardScope("weekly");
    setIsLeaderboardClosing(false);
    setShowLeaderboardModal(true);
  }, []);

  const toggleLeaderboardScope = useCallback(() => {
    setLeaderboardScope((current) => current === "weekly" ? "overall" : "weekly");
  }, []);

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

  useEffect(() => {
    return () => {
      clearInfoCloseTimer();
      clearInfoHideTimer();
      clearSubmissionSuccessTimer();
      clearWalletInfoCloseTimer();
      clearWalletInfoHideTimer();
    };
  }, [clearInfoCloseTimer, clearInfoHideTimer, clearSubmissionSuccessTimer, clearWalletInfoCloseTimer, clearWalletInfoHideTimer]);

  useEffect(() => {
    if (!showLeaderboardModal || !currentUserProfile?.address) {
      return;
    }

    const row = document.querySelector<HTMLElement>(`[data-leaderboard-address="${currentUserProfile.address}"]`);
    row?.scrollIntoView({ block: "center" });
  }, [currentUserProfile?.address, leaderboardScope, overallLeaderboard, showLeaderboardModal, weeklyLeaderboard]);


  useEffect(() => {
    if (!showLeaderboardModal) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showLeaderboardModal]);

  useEffect(() => {
    const handleEscapeClose = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (showInfoModal) {
        if (infoModalMode === "save-draft-confirm") {
          return;
        }

        closeInfoModal();
        return;
      }

      if (showLeaderboardModal) {
        closeLeaderboardModal();
        return;
      }

      if (showCreateModal) {
        requestCloseCreateModal();
      }
    };

    window.addEventListener("keydown", handleEscapeClose);
    return () => {
      window.removeEventListener("keydown", handleEscapeClose);
    };
  }, [closeInfoModal, closeLeaderboardModal, infoModalMode, requestCloseCreateModal, showCreateModal, showInfoModal, showLeaderboardModal]);

  const shouldHideWalletAction = showCreateModal && !isCreateModalClosing;
  const canEditDisplayName = Boolean(signer && walletAddress && currentUserProfile?.address === walletAddress);
  const activeLeaderboard = leaderboardScope === "weekly" ? weeklyLeaderboard : overallLeaderboard;
  const activeLeaderboardLabel = leaderboardScope === "weekly" ? "Weekly" : "Overall";
  const activeLeaderboardTitle = `${activeLeaderboardLabel} Ranking`;
  const currentUserWeeklyRank = currentUserProfile?.weeklyRank ?? 0;
  const currentUserRankLabel = currentUserWeeklyRank > 0 ? `#${currentUserWeeklyRank}` : "#--";

  const profilePageErrorMessages = [userProfileError].filter((message) => message.trim().length > 0);
  const isAwaitingInitialProfile = (!targetHandle && Boolean(signer) && !currentUserProfile && !userProfileError)
    || (Boolean(targetHandle) && !currentUserProfile && !userProfileError);
  const isProfileLoading = isUserProfileLoading || isAwaitingInitialProfile || (!targetHandle && Boolean(signer) && walletInfoLoading && !walletAddress);
  const hasProfileErrors = profilePageErrorMessages.length > 0;
  const handleLabel = currentUserProfile?.handle ?? "";
  const fullAddressLabel = currentUserProfile?.address ?? (walletAddress || "");
  const walletBalanceText = walletBalance !== null ? `${formatCkbAmount(walletBalance)} CKB` : "--";
  const profileLoadErrorMessage = hasProfileErrors
    ? "Sorry, an error occurred. Hover on info for more."
    : "";
  const hasCurrentProfile = Boolean(currentUserProfile);
  const currentProfileAddress = currentUserProfile?.address ?? "";
  const isProfileAvatarVisible = revealedProfileHeroCount >= 1;
  const isProfileStatsVisible = revealedProfileHeroCount >= 2;
  const isProfileAddressVisible = revealedProfileHeroCount >= 3;

  useEffect(() => {
    if (isProfileLoading || !hasCurrentProfile) {
      setRevealedProfileHeroCount(0);
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRevealedProfileHeroCount(PROFILE_HERO_REVEAL_ITEM_COUNT);
      return;
    }

    setRevealedProfileHeroCount(0);
    const timeoutIds = Array.from({ length: PROFILE_HERO_REVEAL_ITEM_COUNT }, (_, index) => window.setTimeout(() => {
      setRevealedProfileHeroCount(index + 1);
    }, index * PROFILE_HERO_REVEAL_STEP_MS));

    return () => {
      timeoutIds.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
    };
  }, [currentProfileAddress, hasCurrentProfile, isProfileLoading]);

  const openDisplayNameModal = useCallback(() => {
    if (!canEditDisplayName) {
      return;
    }

    clearInfoCloseTimer();
    clearInfoHideTimer();
    setDisplayNameDraft(currentUserProfile?.displayName ?? "");
    setDisplayNameModalError("");
    setInfoModalMode("edit-display-name");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [
    canEditDisplayName,
    clearInfoCloseTimer,
    clearInfoHideTimer,
    currentUserProfile?.displayName,
    setDisplayNameDraft,
    setDisplayNameModalError,
    setInfoModalInteraction,
    setIsInfoModalClosing,
    setShowInfoModal,
  ]);

  const handleDisplayNameSave = useCallback(async () => {
    const nextName = displayNameDraft.trim();

    if (!nextName) {
      setDisplayNameModalError("Display name is required.");
      return;
    }

    try {
      const savedProfile = await saveDisplayName(nextName);
      setDisplayNameModalError("");
      closeInfoModal();

      const nextHandle = savedProfile?.username ?? currentUserProfile?.username ?? targetHandle ?? "";
      if (targetHandle && nextHandle) {
        router.replace(`/user/${encodeURIComponent(nextHandle)}`);
      }
    } catch (error) {
      setDisplayNameModalError(error instanceof Error ? error.message : "Failed to update display name");
    }
  }, [closeInfoModal, currentUserProfile?.username, displayNameDraft, router, saveDisplayName, setDisplayNameModalError, targetHandle]);

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
  ) : infoModalMode === "submission-error" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-red-500">Oops, an error occurred</p>
      <p className="create-info-constraint-item text-red-500 break-words">
        <span>{submissionErrorMessage}</span>
      </p>
    </div>
  ) : infoModalMode === "insufficient-fbars" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">Not enough FBARS</p>
      <p className="create-info-constraint-item text-gray-500 break-words">
        <span>{INSUFFICIENT_FBARS_MESSAGE}</span>
      </p>
    </div>
  ) : infoModalMode === "edit-display-name" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">Only the display name is editable:</p>
      {displayNameModalError || userProfileError ? (
        <p className="create-info-constraint-item text-red-500 mt-3">
          <span>{displayNameModalError || userProfileError}</span>
        </p>
      ) : null}
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
      <div className="create-info-forms-config">
        <div className="create-review-card-heading-row">
          <p className="create-review-section-label text-gray-900">Lock criteria:</p>
          {mountablesPromptError ? <p className="create-info-forms-inline-error">{mountablesPromptError}</p> : null}
        </div>
        <div className="create-info-forms-row flex items-center gap-2">
          <span className="create-review-section-label text-gray-900">With:</span>
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
            className={`create-info-ticket-input ${mountableLockValidationState === "invalid" ? "create-info-ticket-input-invalid" : mountableLockValidationState === "valid" ? "create-info-ticket-input-valid" : isMountableLockFocused ? "create-info-ticket-input-focused" : ""}`.trim()}
            aria-label="Lock FBARS threshold"
          />
          <span className="create-info-constraint-item text-gray-500"><span>fbars</span></span>
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
  ) : showLeaderboardModal ? (
    <div className="create-info-constraints-copy">
      <p>{activeLeaderboardTitle}:</p>
      {activeLeaderboard.slice(0, 5).map((entry) => (
        <p key={entry.address} className="create-info-constraint-item text-gray-500">
          <span>#{entry.rank} {entry.handle} — {entry.fbars} FBARS</span>
        </p>
      ))}
      {profilePageErrorMessages.length > 0 ? (
        <>
          <p className="mt-3 text-red-500 font-semibold">Errors:</p>
          {profilePageErrorMessages.map((message) => (
            <p key={message} className="create-info-constraint-item text-red-500 break-words">
              <span>{message}</span>
            </p>
          ))}
        </>
      ) : null}
    </div>
  ) : (
    <div className="create-info-constraints-copy">
      <p>{PROFILE_INFO_FBARS_HEADING}</p>
      <p className="create-info-constraint-item">
        <span>{PROFILE_INFO_FBARS_MESSAGE}</span>
      </p>
      <p className="mt-3">{PROFILE_INFO_ADSF_HEADING}</p>
      <p className="create-info-constraint-item">
        <span>{PROFILE_INFO_ADSF_MESSAGE}</span>
      </p>
      {profilePageErrorMessages.length > 0 ? (
        <>
          <p className="mt-3 text-red-500 font-semibold">Errors:</p>
          {profilePageErrorMessages.map((message) => (
            <p key={message} className="create-info-constraint-item text-red-500 break-words">
              <span>{message}</span>
            </p>
          ))}
        </>
      ) : null}
    </div>
  );

  const infoModalActions = infoModalMode === "edit-display-name" ? (
    <div className="profile-display-name-edit-row">
      <input
        type="text"
        value={displayNameDraft}
        maxLength={10}
        onChange={(event) => {
          setDisplayNameDraft(event.target.value);
          if (displayNameModalError) {
            setDisplayNameModalError("");
          }
        }}
        onClick={(event) => {
          if (event.currentTarget.value.length > 0) {
            event.currentTarget.select();
          }
        }}
        className="create-info-ticket-input profile-display-name-input"
        aria-label="Display name"
        disabled={isSavingUserProfile}
      />
      <button
        type="button"
        className="create-info-confirm-btn create-info-confirm-btn-primary profile-display-name-confirm-btn"
        onClick={() => void handleDisplayNameSave()}
        disabled={isSavingUserProfile}
      >
        {isSavingUserProfile ? "Saving..." : "Confirm"}
      </button>
    </div>
  ) : showCreateModal && infoModalMode === "save-draft-confirm" ? (
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

  return (
    <main className="profile-page">
      <div className="campaign-shell-width profile-page-shell">
        <AppShellHeader
          className={`campaign-shell-header campaign-shell-width ${showCreateModal || showLeaderboardModal ? "campaign-shell-header-transparent" : ""} fixed top-0 left-4 right-4 z-[70] mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`.trim()}
          infoButtonAriaLabel="Open Freight information"
          infoModalAriaLabel={infoModalMode === "submission-success" ? "Submission successful" : infoModalMode === "submission-error" ? "Transaction error" : infoModalMode === "insufficient-fbars" ? "Not enough FBARS" : showCreateModal ? "Create freight info" : "Freight information modal"}
          infoModalBackdropAriaLabel={infoModalMode === "save-draft-confirm" ? "Return to create freight modal" : "Close Freight information modal"}
          infoModalBackdropInteractive={infoModalInteraction === "click" || infoModalMode === "save-draft-confirm" || infoModalMode === "submission-success"}
          infoModalBody={infoModalBody}
          infoModalActions={infoModalActions}
          infoModalClosing={isInfoModalClosing}
          infoModalOpen={showInfoModal}
          isConnected={Boolean(signer)}
          onConnect={openWalletWithSeed}
          onContainerClick={showCreateModal ? (event) => {
            if (event.target === event.currentTarget) {
              requestCloseCreateModal();
            }
          } : undefined}
          onCopyWalletAddress={() => void handleCopyWalletAddress()}
          onDisconnect={disconnect}
          onInfoButtonBlur={() => scheduleCloseInfoModal(infoModalMode === "save-draft-confirm" || infoModalMode === "edit-display-name" || infoModalMode === "mountables" || infoModalMode === "mountables-lock" || infoModalMode === "mountables-forms", resetInfoModalState)}
          onInfoButtonClick={() => router.push("/")}
          onInfoButtonFocus={() => openInfoModalFromHover(infoModalMode === "save-draft-confirm" || infoModalMode === "edit-display-name" || infoModalMode === "mountables" || infoModalMode === "mountables-lock" || infoModalMode === "mountables-forms")}
          onInfoModalKeepOpen={keepInfoModalOpen}
          onInfoModalRequestClose={() => closeInfoModal(resetInfoModalState)}
          onInfoModalScheduleClose={() => scheduleCloseInfoModal(infoModalMode === "save-draft-confirm" || infoModalMode === "edit-display-name" || infoModalMode === "mountables" || infoModalMode === "mountables-lock" || infoModalMode === "mountables-forms", resetInfoModalState)}
          onInfoMouseEnter={() => openInfoModalFromHover(infoModalMode === "save-draft-confirm" || infoModalMode === "edit-display-name" || infoModalMode === "mountables" || infoModalMode === "mountables-lock" || infoModalMode === "mountables-forms")}
          onInfoMouseLeave={() => scheduleCloseInfoModal(infoModalMode === "save-draft-confirm" || infoModalMode === "edit-display-name" || infoModalMode === "mountables" || infoModalMode === "mountables-lock" || infoModalMode === "mountables-forms", resetInfoModalState)}
          onInfoWrapClick={(event) => event.stopPropagation()}
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
          replaceWalletAction={showLeaderboardModal ? (
            <div className={`profile-header-replacement-actions ${isLeaderboardClosing ? "profile-header-replacement-actions-closing" : ""}`}>
              <button
                type="button"
                className="create-modal-action-btn"
                data-tooltip="Scroll to top"
                onClick={() => {
                  const leaderboardList = document.querySelector<HTMLElement>(".profile-leaderboard-list");
                  leaderboardList?.scrollTo({ top: 0, behavior: "smooth" });
                }}
                aria-label="Scroll to top of leaderboard"
              >
                <ArrowUp className="campaign-action-icon" size={22} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="create-modal-action-btn"
                data-tooltip="Search users"
                aria-label="Search users coming soon"
              >
                <Search className="campaign-action-icon" size={22} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          ) : undefined}
          canEditLightModePrimaryColor={canEditDisplayName}
          currentLightModePrimaryColor={currentUserProfile?.lightModePrimaryColor ?? null}
          shouldHideWalletAction={shouldHideWalletAction}
          isSavingLightModePrimaryColor={isSavingUserProfile}
          onSaveLightModePrimaryColor={saveLightModePrimaryColor}
          walletAddress={walletAddress}
          walletAddressDisplay={walletAddressDisplay}
          walletBalanceIncreasing={walletBalanceIncreasing}
          walletBalanceText={walletBalanceText}
          walletChainLabel={walletChainLabel}
          walletCopyFeedback={walletCopyFeedback}
          walletInfoButtonRef={headerInfoButtonRef}
          walletInfoError={walletInfoError}
          walletModalClosing={isWalletInfoClosing}
          walletModalOpen={showWalletInfoModal}
          walletUsdParts={walletUsdParts}
          walletActionOnly={false}
        />

        {isProfileLoading ? (
          <div className="profile-status-block">
            <ThreeDotLoader label="Loading profile" />
          </div>
        ) : profileLoadErrorMessage ? (
          <p className="profile-load-error">{profileLoadErrorMessage}</p>
        ) : (
          <>
            <div className="profile-hero-row">
              <div className={`profile-avatar-column profile-hero-item ${isProfileAvatarVisible ? "profile-hero-item-visible" : ""}`.trim()}>
                <div className="profile-avatar-placeholder" aria-hidden="true">
                  <span>Profile photo</span>
                </div>
                <div className="profile-handle-edit-row">
                  <p className="profile-handle profile-handle-under-avatar">{handleLabel}</p>
                  {canEditDisplayName ? (
                    <button
                      type="button"
                      className="profile-display-name-edit-trigger"
                      onClick={openDisplayNameModal}
                      aria-label="Edit display name"
                    >
                      <Pencil size={14} strokeWidth={2} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>

              <section className="profile-summary-card">
                <div className={`profile-stats-column profile-hero-item ${isProfileStatsVisible ? "profile-hero-item-visible" : ""}`.trim()}>
                  <div className="profile-rank-row">
                    <p className="profile-reputation-balance"><span className="profile-display-name-inline">{currentUserProfile?.displayName ?? ""}</span>: {currentUserProfile?.fbars ?? 0} FBARS</p>
                    <button
                      type="button"
                      className="profile-rank-link"
                      onClick={openLeaderboardModal}
                      disabled={!currentUserProfile}
                    >
                      {currentUserRankLabel}
                    </button>
                  </div>
                  <div className="profile-balance-inline-group profile-balance-inline-group-single-line">
                    <span className="profile-wallet-balance-note">ADSF:</span>
                    <div className="profile-usd-balance" aria-live="polite">
                      <span>{adsfUsdParts?.whole ?? "--"} </span>
                      <span className="profile-usd-suffix">USD</span>
                    </div>
                  </div>
                </div>

                <div className={`profile-address-block profile-hero-item ${isProfileAddressVisible ? "profile-hero-item-visible" : ""}`.trim()}>
                  <div className="profile-address-row">
                    <span className="profile-address-value">{fullAddressLabel}</span>
                    {signer && walletAddress && currentUserProfile?.address === walletAddress ? (
                      <button
                        type="button"
                        className="wallet-info-copy-btn profile-address-copy-btn"
                        onClick={() => void handleCopyWalletAddress()}
                        title={walletAddress}
                        aria-label="Copy full wallet address"
                      >
                        {walletCopyFeedback === "copied" ? (
                          <Check size={14} strokeWidth={2.4} aria-hidden="true" className="profile-address-copy-success" />
                        ) : (
                          <Copy size={14} strokeWidth={2} aria-hidden="true" />
                        )}
                      </button>
                    ) : null}
                  </div>
                  <p className="profile-address-chain text-xs text-blue-600">({walletChainLabel})</p>
                  {walletCopyFeedback === "error" ? <span className="wallet-info-feedback wallet-info-feedback-error">Copy failed</span> : null}
                </div>
              </section>
            </div>

            {currentUserProfile ? (
              <>
                <div className="profile-tab-shell">
                  <div className="profile-tab-bar" role="tablist" aria-label="Profile views">
                    {PROFILE_TABS.map((tab) => {
                      const isSelected = activeTab === tab.key;
                      const isRefreshingActiveTab = (tab.key === "freights" && isProfileFreightsRefreshing)
                        || (tab.key === "transactions" && isProfileTransactionsRefreshing);

                      return (
                        <button
                          key={tab.key}
                          type="button"
                          role="tab"
                          aria-controls={`profile-tab-panel-${tab.key}`}
                          aria-selected={isSelected}
                          id={`profile-tab-${tab.key}`}
                          className={`profile-tab-button ${isSelected ? "profile-tab-button-active" : ""}`.trim()}
                          onClick={() => {
                            if (isSelected) {
                              if (tab.key === "freights") {
                                refreshProfileFreights();
                                return;
                              }

                              if (tab.key === "transactions") {
                                refreshProfileTransactions();
                                return;
                              }
                            }

                            setActiveTab(tab.key);
                          }}
                        >
                          {isRefreshingActiveTab ? (
                            <ThreeDotLoader className="profile-tab-button-loader" label={`Refreshing ${tab.label}`} />
                          ) : (
                            tab.label
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {activeTab === "activity" ? (
                  <div id="profile-tab-panel-activity" aria-labelledby="profile-tab-activity" role="tabpanel">
                    <ProfileAnalyticsSection
                      analytics={profileAnalytics}
                      error={profileAnalyticsError}
                      loading={isProfileAnalyticsLoading}
                    />
                  </div>
                ) : null}
                {activeTab === "freights" ? (
                  <div id="profile-tab-panel-freights" aria-labelledby="profile-tab-freights">
                    <ProfileFreightsSection
                      error={profileFreightsError}
                      hasLoaded={hasLoadedProfileFreights}
                      isRefreshing={isProfileFreightsRefreshing}
                      loading={isProfileFreightsLoading}
                      rows={profileFreightRows}
                    />
                  </div>
                ) : null}
                {activeTab === "transactions" ? (
                  <div id="profile-tab-panel-transactions" aria-labelledby="profile-tab-transactions">
                    <ProfileTransactionsSection
                      coverage={profileTransactionsCoverage}
                      error={profileTransactionsError}
                      hasLoaded={hasLoadedProfileTransactions}
                      isRefreshing={isProfileTransactionsRefreshing}
                      loading={isProfileTransactionsLoading}
                      rows={profileTransactionRows}
                    />
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>

      {showLeaderboardModal ? (
        <>
          <button
            type="button"
            className={`create-campaign-backdrop profile-leaderboard-backdrop ${isLeaderboardClosing ? "create-campaign-backdrop-closing" : ""}`}
            aria-label="Close Bars Listings modal"
            onClick={closeLeaderboardModal}
          />
          <div
            className={`create-campaign-modal profile-leaderboard-dialog ${isLeaderboardClosing ? "create-campaign-modal-closing" : ""}`}
            role="dialog"
            aria-label="Bars Listings"
            aria-modal="true"
            onClick={closeLeaderboardModal}
          >
            <div className="profile-leaderboard-modal" onClick={(event) => event.stopPropagation()}>
              <div className="profile-leaderboard-header">
                <button
                  type="button"
                  className="profile-leaderboard-title-button"
                  onClick={toggleLeaderboardScope}
                >
                  <h2 className="profile-leaderboard-title">
                    {activeLeaderboardTitle}
                  </h2>
                </button>
                <Trophy className="profile-leaderboard-title-icon" size={24} strokeWidth={2} aria-hidden="true" />
              </div>
              <p className="profile-leaderboard-scope-note">Click title to switch between weekly and overall.</p>
              <div className="profile-leaderboard-list" role="list">
                {activeLeaderboard.map((entry) => {
                  const isCurrentUser = entry.address === currentUserProfile?.address;

                  return (
                    <div
                      key={entry.address}
                      role="listitem"
                      data-leaderboard-address={entry.address}
                      className={`profile-leaderboard-row ${isCurrentUser ? "profile-leaderboard-row-current" : ""}`}
                    >
                      <span className="profile-leaderboard-rank">#{entry.rank}</span>
                      <Link href={`/user/${encodeURIComponent(entry.username)}`} className="profile-leaderboard-handle">{entry.handle}</Link>
                      <span className="profile-leaderboard-fbars">{entry.fbars} FBARS</span>
                    </div>
                  );
                })}
                {activeLeaderboard.length === 0 ? (
                  <p className="profile-leaderboard-scope-note">No ranked users yet.</p>
                ) : null}
              </div>
            </div>
          </div>
        </>
      ) : null}

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
    </main>
  );
}
