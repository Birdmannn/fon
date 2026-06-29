"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle,
  Copy,
  House,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trophy,
} from "lucide-react";
import { ccc } from "@ckb-ccc/connector-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import AppShellHeader from "@/app/_components/AppShellHeader";
import ThreeDotLoader from "@/app/_components/ThreeDotLoader";
import { useInfoModalState } from "@/app/_hooks/useInfoModalState";
import { useUserProfile } from "@/app/_hooks/useUserProfile";
import { useWalletInfo } from "@/app/_hooks/useWalletInfo";
import CreateCampaignModalContent, {
  CreateCampaignModalContentHandle,
  CreateConstraintStatus,
  CreateModalStep,
} from "@/app/create/_components/CreateCampaignModalContent";
import { formatCkbAmount } from "@/lib/campaignDisplay";

const INFO_MODAL_ANIMATION_MS = 620;
const CREATE_INFO_CONSTRAINT_HEADING = "Creation constraints:";
const CREATE_INFO_CONSTRAINT_ITEMS: Array<{
  key: keyof CreateConstraintStatus;
  text: string;
}> = [
  { key: "titlePassed", text: "1. Title is required." },
  { key: "bodyPassed", text: "2. Body must be at least 120 characters (Well, ofcourse, we can keep it 15 if it's a Raffle)" },
  {
    key: "firstHashtagPassed",
    text: "3. The first hashtag (there must be a first hashtag) must be exactly one of #SimpleTask, #FundedTask, #Crowdfunding, #TimedChallenge, or #Raffle.",
  },
  { key: "additionalHashtagsPassed", text: "4. Additional hashtags may follow after the first compulsory hashtag." },
];
const CREATE_INFO_TYPING_HEADING = "Typing:";
const CREATE_INFO_TYPING_ITEMS = [
  "Start with 1. then press Enter to continue numbered lists.",
  "Start with -, *, or • then press Enter to continue bullet lists.",
  "Start with [ ] or [x] to continue checkbox items.",
  "Type ## at the start of a line for a larger heading line.",
  "Use # for hashtags and @ for mentions.",
];
const CREATE_INFO_PREVIEW_HEADING = "Preview:";
const CREATE_INFO_PREVIEW_ITEMS = [
  "The generated summary is the short on-chain version of the post.",
  "It is required because on-chain summary storage is limited to 64 UTF-8 bytes.",
  "You can edit the summary before publishing if you want a clearer on-chain description.",
  "Review and set the campaign args here, especially duration and max deposit.",
  "If the first hashtag is #Raffle, a ticket price is also required.",
  "The full title, description, mentions, and review snapshot are saved off-chain.",
];
const PROFILE_INFO_FBARS_HEADING = "FBARS:";
const PROFILE_INFO_FBARS_MESSAGE = "Calculcation and Minting Coming Soon.";

type InfoModalMode = "about" | "edit-display-name" | "save-draft-confirm" | "submission-success" | "submission-error";

type ProfileScreenProps = {
  targetHandle?: string | null;
};

export default function ProfileScreen({ targetHandle = null }: ProfileScreenProps) {
  const { open, disconnect, client } = ccc.useCcc();
  const signer = ccc.useSigner();
  const router = useRouter();
  const headerInfoButtonRef = useRef<HTMLButtonElement>(null);
  const createModalContentRef = useRef<CreateCampaignModalContentHandle>(null);
  const walletInfoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletInfoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [infoModalMode, setInfoModalMode] = useState<InfoModalMode>("about");
  const [saveDraftPromptError, setSaveDraftPromptError] = useState("");
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [displayNameModalError, setDisplayNameModalError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreateModalClosing, setIsCreateModalClosing] = useState(false);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [isLeaderboardClosing, setIsLeaderboardClosing] = useState(false);
  const [createResetSignal, setCreateResetSignal] = useState(0);
  const [createStepBackSignal, setCreateStepBackSignal] = useState(0);
  const [createModalStep, setCreateModalStep] = useState<CreateModalStep>("compose");
  const [constraintStatus, setConstraintStatus] = useState<CreateConstraintStatus>({
    titlePassed: false,
    bodyPassed: false,
    firstHashtagPassed: false,
    additionalHashtagsPassed: true,
  });
  const [previewError, setPreviewError] = useState("");
  const [isCreateDraftListOpen, setIsCreateDraftListOpen] = useState(false);
  const [pendingDraftSelectionId, setPendingDraftSelectionId] = useState<string | null>(null);
  const [pendingCloseAfterWalletConnect, setPendingCloseAfterWalletConnect] = useState(false);
  const [submissionSuccessTxHash, setSubmissionSuccessTxHash] = useState("");
  const [submissionSuccessPreimage, setSubmissionSuccessPreimage] = useState<string | null>(null);
  const [submissionErrorMessage, setSubmissionErrorMessage] = useState("");
  const [showWalletInfoModal, setShowWalletInfoModal] = useState(false);
  const [isWalletInfoClosing, setIsWalletInfoClosing] = useState(false);

  const resetInfoModalState = useCallback(() => {
    setInfoModalMode("about");
    setSaveDraftPromptError("");
    setDisplayNameDraft("");
    setDisplayNameModalError("");
    setSubmissionSuccessTxHash("");
    setSubmissionSuccessPreimage(null);
    setSubmissionErrorMessage("");
  }, [
    setDisplayNameDraft,
    setDisplayNameModalError,
    setInfoModalMode,
    setSaveDraftPromptError,
    setSubmissionErrorMessage,
    setSubmissionSuccessPreimage,
    setSubmissionSuccessTxHash,
  ]);

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
    toggleInfoModal,
    keepInfoModalOpen,
  } = useInfoModalState({
    animationMs: INFO_MODAL_ANIMATION_MS,
    onResetState: resetInfoModalState,
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
    leaderboard,
    saveDisplayName,
    userProfileError,
  } = useUserProfile(signer ?? null, targetHandle);

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

  const clearCreateHideTimer = useCallback(() => {
    if (createHideTimerRef.current) {
      clearTimeout(createHideTimerRef.current);
      createHideTimerRef.current = null;
    }
  }, []);

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
    setIsLeaderboardClosing(false);
    setShowLeaderboardModal(true);
  }, []);

  const openSaveDraftConfirmModal = useCallback(() => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    setInfoModalMode("save-draft-confirm");
    setSaveDraftPromptError("");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearInfoCloseTimer, clearInfoHideTimer, setInfoModalInteraction, setIsInfoModalClosing, setShowInfoModal]);

  const finalizeCloseCreateModal = useCallback(() => {
    if (!showCreateModal || isCreateModalClosing) {
      return;
    }

    setIsCreateModalClosing(true);
    clearCreateHideTimer();
    createHideTimerRef.current = setTimeout(() => {
      setShowCreateModal(false);
      setIsCreateModalClosing(false);
      setCreateModalStep("compose");
      setPreviewError("");
      setSaveDraftPromptError("");
      setIsCreateDraftListOpen(false);
      createHideTimerRef.current = null;
    }, INFO_MODAL_ANIMATION_MS);
  }, [clearCreateHideTimer, isCreateModalClosing, showCreateModal]);

  const openSubmissionSuccessInfoModal = useCallback((txHash: string, randomnessPreimage: string | null = null) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer();
    setSubmissionErrorMessage("");
    setSubmissionSuccessTxHash(txHash);
    setSubmissionSuccessPreimage(randomnessPreimage);
    setInfoModalMode("submission-success");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
    submissionSuccessTimerRef.current = setTimeout(() => {
      closeInfoModal();
    }, randomnessPreimage ? 12000 : 2500);
  }, [clearInfoCloseTimer, clearInfoHideTimer, clearSubmissionSuccessTimer, closeInfoModal, setInfoModalInteraction, setIsInfoModalClosing, setShowInfoModal, submissionSuccessTimerRef]);

  const openCreateModal = useCallback(() => {
    clearCreateHideTimer();
    setIsCreateModalClosing(false);
    setCreateModalStep("compose");
    setPreviewError("");
    setSaveDraftPromptError("");
    setIsCreateDraftListOpen(false);
    setShowCreateModal(true);
  }, [clearCreateHideTimer]);

  const requestCloseCreateModal = useCallback(() => {
    setPendingDraftSelectionId(null);
    setPendingCloseAfterWalletConnect(false);
    if (createModalContentRef.current?.hasDraftableChanges()) {
      openSaveDraftConfirmModal();
      return;
    }

    finalizeCloseCreateModal();
  }, [finalizeCloseCreateModal, openSaveDraftConfirmModal]);

  const handleDraftSelectionRequest = useCallback((draftId: string) => {
    setPendingCloseAfterWalletConnect(false);
    setPendingDraftSelectionId(draftId);
    if (createModalContentRef.current?.hasDraftableChanges()) {
      openSaveDraftConfirmModal();
      return;
    }

    createModalContentRef.current?.applyDraftSelection(draftId);
  }, [openSaveDraftConfirmModal]);

  const handleSaveDraftChoice = useCallback(async (shouldSave: boolean) => {
    try {
      if (!shouldSave) {
        if (pendingDraftSelectionId) {
          createModalContentRef.current?.applyDraftSelection(pendingDraftSelectionId);
          setPendingDraftSelectionId(null);
          closeInfoModal();
          return;
        }

        setPendingDraftSelectionId(null);
        setPendingCloseAfterWalletConnect(false);
        closeInfoModal();
        finalizeCloseCreateModal();
        return;
      }

      try {
        await createModalContentRef.current?.saveDraftFromClose();
      } catch (error) {
        if (error instanceof Error && error.message === "Connect wallet to manage drafts") {
          setPendingCloseAfterWalletConnect(!pendingDraftSelectionId);
          open();
          return;
        }
        throw error;
      }

      if (pendingDraftSelectionId) {
        createModalContentRef.current?.applyDraftSelection(pendingDraftSelectionId);
        setPendingDraftSelectionId(null);
        closeInfoModal();
        return;
      }

      createModalContentRef.current?.discardDraftSession();
      setPendingCloseAfterWalletConnect(false);
      closeInfoModal();
      finalizeCloseCreateModal();
    } catch (error) {
      setSaveDraftPromptError(error instanceof Error ? error.message : "Failed to save draft");
    }
  }, [closeInfoModal, finalizeCloseCreateModal, open, pendingDraftSelectionId]);

  const resetCreateModal = useCallback(() => {
    setCreateModalStep("compose");
    setPreviewError("");
    setCreateResetSignal((current) => current + 1);
  }, []);

  const handleCreateTopRightAction = useCallback(() => {
    if (createModalStep === "review") {
      setCreateStepBackSignal((current) => current + 1);
      setCreateModalStep("compose");
      setPreviewError("");
      return;
    }

    void createModalContentRef.current?.toggleDraftList().catch(() => undefined);
  }, [createModalStep]);

  useEffect(() => {
    return () => {
      clearInfoCloseTimer();
      clearInfoHideTimer();
      clearCreateHideTimer();
      clearSubmissionSuccessTimer();
      clearWalletInfoCloseTimer();
      clearWalletInfoHideTimer();
    };
  }, [clearCreateHideTimer, clearInfoCloseTimer, clearInfoHideTimer, clearSubmissionSuccessTimer, clearWalletInfoCloseTimer, clearWalletInfoHideTimer]);

  useEffect(() => {
    if (!showLeaderboardModal || !currentUserProfile?.address) {
      return;
    }

    const row = document.querySelector<HTMLElement>(`[data-leaderboard-address="${currentUserProfile.address}"]`);
    row?.scrollIntoView({ block: "center" });
  }, [currentUserProfile?.address, showLeaderboardModal]);

  useEffect(() => {
    if (!pendingCloseAfterWalletConnect || !signer) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await createModalContentRef.current?.saveDraftFromClose();
        if (cancelled) {
          return;
        }
        createModalContentRef.current?.discardDraftSession();
        setPendingCloseAfterWalletConnect(false);
        closeInfoModal();
        finalizeCloseCreateModal();
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSaveDraftPromptError(error instanceof Error ? error.message : "Failed to save draft");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [closeInfoModal, finalizeCloseCreateModal, pendingCloseAfterWalletConnect, signer]);

  useEffect(() => {
    if (!showCreateModal && !showLeaderboardModal) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showCreateModal, showLeaderboardModal]);

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
  const currentUserRankLabel = currentUserProfile ? `#${currentUserProfile.rank}` : "#--";
  const createTopActionTooltip = createModalStep === "review" ? "Back" : isCreateDraftListOpen ? "Hide drafts" : "Load drafts";
  const createTopActionLabel = createModalStep === "review" ? "Back to compose step" : isCreateDraftListOpen ? "Hide saved drafts" : "Load saved drafts";

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
  const homeHref = "/";

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
      {submissionSuccessPreimage ? (
        <>
          <p className="mt-3 text-gray-900 font-semibold text-xs">Randomness preimage</p>
          <p className="text-xs text-amber-600 mt-1">
            You can store it if you wish — it is used to distribute raffle rewards.
          </p>
          <p className="create-info-constraint-item text-gray-500 font-mono break-all text-xs mt-1">
            {submissionSuccessPreimage}
          </p>
        </>
      ) : null}
    </div>
  ) : infoModalMode === "submission-error" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-red-500">Oops, an error occurred</p>
      <p className="create-info-constraint-item text-red-500 break-words">
        <span>{submissionErrorMessage}</span>
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
  ) : (
    <div className="create-info-constraints-copy">
      <p>{PROFILE_INFO_FBARS_HEADING}</p>
      <p className="create-info-constraint-item">
        <span>{PROFILE_INFO_FBARS_MESSAGE}</span>
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
  ) : undefined;

  return (
    <main className="profile-page">
      <div className="campaign-shell-width profile-page-shell">
        <AppShellHeader
          className="campaign-shell-header campaign-shell-width fixed top-8 left-4 right-4 z-[70] mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
          infoButtonAriaLabel="Open Freight information"
          infoModalAriaLabel={infoModalMode === "submission-success" ? "Submission successful" : infoModalMode === "submission-error" ? "Transaction error" : showCreateModal ? "Create freight info" : "Freight information modal"}
          infoModalBackdropAriaLabel={infoModalMode === "save-draft-confirm" ? "Return to create freight modal" : "Close Freight information modal"}
          infoModalBackdropInteractive={infoModalInteraction === "click" || infoModalMode === "save-draft-confirm" || infoModalMode === "submission-success"}
          infoModalBody={infoModalBody}
          infoModalActions={infoModalActions}
          infoModalClosing={isInfoModalClosing}
          infoModalOpen={showInfoModal}
          isConnected={Boolean(signer)}
          onConnect={open}
          onContainerClick={showCreateModal ? (event) => {
            if (event.target === event.currentTarget) {
              requestCloseCreateModal();
            }
          } : undefined}
          onCopyWalletAddress={() => void handleCopyWalletAddress()}
          onDisconnect={disconnect}
          onInfoButtonBlur={() => scheduleCloseInfoModal(infoModalMode === "save-draft-confirm" || infoModalMode === "edit-display-name", resetInfoModalState)}
          onInfoButtonClick={() => toggleInfoModal(infoModalMode === "save-draft-confirm" || infoModalMode === "edit-display-name")}
          onInfoButtonFocus={() => openInfoModalFromHover(infoModalMode === "save-draft-confirm" || infoModalMode === "edit-display-name")}
          onInfoModalKeepOpen={keepInfoModalOpen}
          onInfoModalRequestClose={() => closeInfoModal(resetInfoModalState)}
          onInfoModalScheduleClose={() => scheduleCloseInfoModal(infoModalMode === "save-draft-confirm" || infoModalMode === "edit-display-name", resetInfoModalState)}
          onInfoMouseEnter={() => openInfoModalFromHover(infoModalMode === "save-draft-confirm" || infoModalMode === "edit-display-name")}
          onInfoMouseLeave={() => scheduleCloseInfoModal(infoModalMode === "save-draft-confirm" || infoModalMode === "edit-display-name", resetInfoModalState)}
          onInfoWrapClick={(event) => event.stopPropagation()}
          onWalletActionClick={closeWalletInfoModal}
          onRightActionsClick={(event) => event.stopPropagation()}
          onWalletMouseEnter={keepWalletInfoModalOpen}
          onWalletMouseLeave={scheduleWalletInfoModalClose}
          rightActions={showCreateModal ? (
            <div
              className={`create-modal-top-actions ${isCreateModalClosing ? "create-modal-top-actions-closing" : ""}`}
              role="group"
              aria-label="Create modal controls"
            >
              <button
                type="button"
                className="create-modal-action-btn"
                data-tooltip="Reset form"
                onClick={resetCreateModal}
                aria-label="Reset create campaign form"
              >
                <RotateCcw className="campaign-action-icon" size={22} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="create-modal-action-btn"
                data-tooltip={createTopActionTooltip}
                onClick={handleCreateTopRightAction}
                aria-label={createTopActionLabel}
              >
                {createModalStep === "review" ? (
                  <ArrowLeft className="campaign-action-icon" size={22} strokeWidth={2} aria-hidden="true" />
                ) : (
                  <span className={`create-modal-toggle-icon-wrap ${isCreateDraftListOpen ? "create-modal-toggle-icon-wrap-open" : ""}`}>
                    <ArrowDown className="campaign-action-icon create-modal-toggle-icon create-modal-toggle-icon-down" size={26} strokeWidth={2} aria-hidden="true" />
                    <ArrowUp className="campaign-action-icon create-modal-toggle-icon create-modal-toggle-icon-up" size={26} strokeWidth={2} aria-hidden="true" />
                  </span>
                )}
              </button>
            </div>
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
          shouldHideWalletAction={shouldHideWalletAction}
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
          walletActionHref={homeHref}
          walletActionIcon={<House size={14} strokeWidth={2} aria-hidden="true" />}
          walletActionLabel="Home"
          walletActionOnly={true}
        />

        {isProfileLoading ? (
          <div className="profile-status-block">
            <ThreeDotLoader label="Loading profile" />
          </div>
        ) : profileLoadErrorMessage ? (
          <p className="profile-load-error">{profileLoadErrorMessage}</p>
        ) : (
          <div className="profile-hero-row">
            <div className="profile-avatar-column">
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
              <div className="profile-stats-column">
                <div className="profile-rank-row">
                  <p className="profile-reputation-balance"><span className="profile-display-name-inline">{currentUserProfile?.displayName ?? ""}</span>: 0 FBARS</p>
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
                  {walletBalanceText !== "--" ? <span className="profile-wallet-balance-note">{walletBalanceText}</span> : null}
                  <span className="wallet-info-balance-approx">≈</span>
                  <div className="profile-usd-balance" aria-live="polite">
                    <span className="profile-usd-currency">$</span>
                    <span>{walletUsdParts?.whole ?? "--"}</span>
                    <span className="profile-usd-decimals">{walletUsdParts ? walletUsdParts.decimals : "--"}</span>
                  </div>
                </div>
              </div>

              <div className="profile-address-block">
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
                      <Copy size={14} strokeWidth={2} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                {walletCopyFeedback === "copied" ? <span className="wallet-info-feedback">Copied</span> : null}
                {walletCopyFeedback === "error" ? <span className="wallet-info-feedback wallet-info-feedback-error">Copy failed</span> : null}
              </div>
            </section>
          </div>
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
                <h2 className="profile-leaderboard-title">
                  W Ranking
                </h2>
                <Trophy className="profile-leaderboard-title-icon" size={24} strokeWidth={2} aria-hidden="true" />
              </div>
              <div className="profile-leaderboard-list" role="list">
                {leaderboard.map((entry) => {
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
              </div>
            </div>
          </div>
        </>
      ) : null}

      {showCreateModal ? (
        <button
          type="button"
          className={`create-campaign-backdrop ${isCreateModalClosing ? "create-campaign-backdrop-closing" : ""}`}
          aria-label="Close create freight modal"
          onClick={requestCloseCreateModal}
        />
      ) : null}

      {showCreateModal ? (
        <div
          className={`create-campaign-modal ${isCreateModalClosing ? "create-campaign-modal-closing" : ""}`}
          role="dialog"
          aria-label="Create freight modal"
          aria-modal="true"
        >
          <CreateCampaignModalContent
            ref={createModalContentRef}
            mode="modal"
            onRequestClose={requestCloseCreateModal}
            resetSignal={createResetSignal}
            stepBackSignal={createStepBackSignal}
            onStepChange={setCreateModalStep}
            onConstraintStatusChange={setConstraintStatus}
            onPreviewErrorChange={setPreviewError}
            onDraftListOpenChange={setIsCreateDraftListOpen}
            onDraftSelectionRequest={handleDraftSelectionRequest}
            onPublishSuccess={(txHash, randomnessPreimage) => {
              finalizeCloseCreateModal();
              openSubmissionSuccessInfoModal(txHash, randomnessPreimage);
            }}
          />
        </div>
      ) : null}

      <button
        type="button"
        aria-label="Open create freight modal"
        className="fixed left-8 create-campaign-fab"
        onClick={openCreateModal}
      >
        <Plus size={48} strokeWidth={2} aria-hidden="true" />
      </button>
    </main>
  );
}
