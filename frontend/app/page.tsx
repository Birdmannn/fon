"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle,
  Copy,
  Plus,
  RotateCcw,
} from "lucide-react";
import { ccc } from "@ckb-ccc/connector-react";
import { useEffect, useState, useRef, useCallback } from "react";

import CampaignFeedSection from "@/app/_components/CampaignFeedSection";
import MountablesPanel from "@/app/_components/MountablesPanel";
import { useInfoModalState } from "@/app/_hooks/useInfoModalState";
import { useTicketPurchaseFlow } from "@/app/_hooks/useTicketPurchaseFlow";
import { useWalletInfo } from "@/app/_hooks/useWalletInfo";
import CreateCampaignModalContent, {
  CreateCampaignModalContentHandle,
  CreateConstraintStatus,
  CreateModalStep,
} from "@/app/create/_components/CreateCampaignModalContent";
import FreightInfoModal from "@/app/_components/FreightInfoModal";
import { type CampaignRecord } from "@/app/_hooks/useCampaignFeed";
import { formatCkbAmount } from "@/lib/campaignDisplay";
import { CampaignCell } from "@/lib/transactions";

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

const HOME_INFO_MOUNTABLES_HEADING = "Mountables:";
const HOME_INFO_MOUNTABLES_ITEMS = ["These are apps mounted on (or as) freights. Coming soon."];
const HOME_INFO_TYPES_HEADING = "Freight types:";
const HOME_INFO_TYPE_ITEMS = [
  "1. Simple Task — a basic freight for posting a task without pooled deposits.",
  "2. Funded Task — a task funded up front so rewards can be distributed from the pool.",
  "3. Crowdfunding — an open funding freight where supporters deposit toward a shared pool.",
  "4. Timed Challenge — a challenge with a defined start and end window.",
  "5. Raffle — a ticket-based freight where entrants buy tickets for a randomized outcome.",
];


  // Add a new mode for ticket purchase success (separate from generic submission-success)
type InfoModalMode = "about" | "save-draft-confirm" | "submission-success" | "ticket-buy-success" | "submission-error" | "discard-comment-confirm" | "ticket-purchase" | "raffle-settlement";
type SettlementRecipient = {
  address: string;
  username: string;
  handle: string;
  amountLabel: string;
};

type SettlementModalData = {
  campaignTitle: string;
  randomnessHash: string;
  randomnessPreimage: string | null;
  evidenceItems: string[];
  recipients: SettlementRecipient[];
  distributionTxHash: string | null;
  errorMessage?: string | null;
  _campaign?: CampaignCell;
  _record?: CampaignRecord | null;
};

export default function Home() {
  const { open, disconnect, client } = ccc.useCcc();
  const signer = ccc.useSigner();
  const INFO_MODAL_ANIMATION_MS = 620;
  const [infoModalMode, setInfoModalMode] = useState<InfoModalMode>("about");
  const [saveDraftPromptError, setSaveDraftPromptError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreateModalClosing, setIsCreateModalClosing] = useState(false);
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
  const [pendingCommentDiscardId, setPendingCommentDiscardId] = useState<string | null>(null);
  const [commentDiscardDecision, setCommentDiscardDecision] = useState<{ cardId: string; discard: boolean } | null>(null);
  const [pendingCloseAfterWalletConnect, setPendingCloseAfterWalletConnect] = useState(false);
  const [submissionSuccessTxHash, setSubmissionSuccessTxHash] = useState("");
  const [submissionSuccessPreimage, setSubmissionSuccessPreimage] = useState<string | null>(null);
  const [submissionErrorMessage, setSubmissionErrorMessage] = useState("");
  const [settlementModalData, setSettlementModalData] = useState<SettlementModalData | null>(null);
  const [isLoadingSettlementModal, setIsLoadingSettlementModal] = useState(false);
  const handleFreightsLoadError = useCallback((message: string) => {
    setSubmissionErrorMessage(message);
  }, []);

  const [showWalletInfoModal, setShowWalletInfoModal] = useState(false);
  const [isWalletInfoClosing, setIsWalletInfoClosing] = useState(false);
  const walletInfoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletInfoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerInfoButtonRef = useRef<HTMLButtonElement>(null);
  const createModalContentRef = useRef<CreateCampaignModalContentHandle>(null);
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
  } = useWalletInfo(client, signer ?? null, showWalletInfoModal);

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
    onResetState: () => {},
  });

  const openTicketBuySuccessInfoModal = useCallback((txHash: string) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer();
    setSubmissionErrorMessage("");
    setSubmissionSuccessTxHash(txHash);
    setInfoModalMode("ticket-buy-success");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
    submissionSuccessTimerRef.current = setTimeout(() => {
      closeInfoModal();
    }, 3000);
  }, [clearInfoCloseTimer, clearInfoHideTimer, clearSubmissionSuccessTimer, closeInfoModal, setInfoModalInteraction, setIsInfoModalClosing, setShowInfoModal, submissionSuccessTimerRef]);

  const {
    handleTicketPurchaseSubmit,
    isPurchasingTickets,
    openTicketPurchaseInfoModal,
    resetTicketPurchaseState,
    setIsPurchasingTickets,
    setTicketPurchaseError,
    setTicketPurchaseQuantity,
    ticketPurchaseError,
    ticketPurchaseQuantity,
  } = useTicketPurchaseFlow({
    onSubmissionError: setSubmissionErrorMessage,
    onTicketBuySuccess: openTicketBuySuccessInfoModal,
  });
  const isInfoModalCloseLocked = infoModalMode === "ticket-purchase" && isPurchasingTickets;

  const handleInfoMouseEnter = useCallback(() => {
    openInfoModalFromHover(infoModalMode === "save-draft-confirm");
  }, [infoModalMode, openInfoModalFromHover]);

  const handleInfoMouseLeave = useCallback(() => {
    scheduleCloseInfoModal(
      infoModalMode === "save-draft-confirm" || isInfoModalCloseLocked,
      () => {
        setInfoModalMode("about");
        setSaveDraftPromptError("");
        setSubmissionSuccessTxHash("");
        setSubmissionSuccessPreimage(null);
        setSubmissionErrorMessage("");
        setSettlementModalData(null);
        setIsLoadingSettlementModal(false);
      }
    );
  }, [infoModalMode, isInfoModalCloseLocked, scheduleCloseInfoModal]);

  const handleInfoButtonToggle = useCallback(() => {
    toggleInfoModal(infoModalMode === "save-draft-confirm" || isInfoModalCloseLocked);
  }, [infoModalMode, isInfoModalCloseLocked, toggleInfoModal]);

  const clearCreateHideTimer = useCallback(() => {
    if (createHideTimerRef.current) {
      clearTimeout(createHideTimerRef.current);
      createHideTimerRef.current = null;
    }
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
    if (!showCreateModal || isCreateModalClosing) return;

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
  }, [clearCreateHideTimer, showCreateModal, isCreateModalClosing]);

  const openSubmissionSuccessInfoModal = useCallback((txHash: string, preimage: string | null = null) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer();
    setSubmissionErrorMessage("");
    setSubmissionSuccessTxHash(txHash);
    setSubmissionSuccessPreimage(preimage);
    setInfoModalMode("submission-success");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
    // Give extra time when showing a preimage — user needs to copy it
    const autoCloseMs = preimage ? 12000 : 2500;
    submissionSuccessTimerRef.current = setTimeout(() => {
      closeInfoModal();
    }, autoCloseMs);
  }, [clearInfoCloseTimer, clearInfoHideTimer, clearSubmissionSuccessTimer, closeInfoModal, setInfoModalInteraction, setIsInfoModalClosing, setShowInfoModal, submissionSuccessTimerRef]);



  const handleOpenTicketPurchaseInfoModal = useCallback((campaign: CampaignCell, record: CampaignRecord | null, onTicketBought: (campaignId: string, ticketPrice: bigint) => void) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer();
    openTicketPurchaseInfoModal(campaign, record, onTicketBought);
    setInfoModalMode("ticket-purchase");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [
    clearInfoCloseTimer,
    clearInfoHideTimer,
    clearSubmissionSuccessTimer,
    openTicketPurchaseInfoModal,
    setInfoModalInteraction,
    setIsInfoModalClosing,
    setShowInfoModal,
  ]);

  const openCreateModal = () => {
    clearCreateHideTimer();
    setIsCreateModalClosing(false);
    setCreateModalStep("compose");
    setPreviewError("");
    setSaveDraftPromptError("");
    setIsCreateDraftListOpen(false);
    setShowCreateModal(true);
  };

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

  const handleCommentDiscardRequest = useCallback((cardId: string) => {
    setPendingCommentDiscardId(cardId);
    setCommentDiscardDecision(null);
    clearInfoCloseTimer();
    clearInfoHideTimer();
    setInfoModalMode("discard-comment-confirm");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearInfoCloseTimer, clearInfoHideTimer, setInfoModalInteraction, setIsInfoModalClosing, setShowInfoModal]);

  const handleCommentDiscardChoice = useCallback((discard: boolean) => {
    if (!pendingCommentDiscardId) {
      closeInfoModal();
      return;
    }

    setCommentDiscardDecision({ cardId: pendingCommentDiscardId, discard });
    setPendingCommentDiscardId(null);
    closeInfoModal();
  }, [closeInfoModal, pendingCommentDiscardId]);

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

  const handleCreateTopRightAction = () => {
    if (createModalStep === "review") {
      setCreateStepBackSignal((current) => current + 1);
      setCreateModalStep("compose");
      setPreviewError("");
      return;
    }

    void createModalContentRef.current?.toggleDraftList().catch(() => undefined);
  };

  useEffect(() => {
    return () => {
      clearInfoCloseTimer();
      clearInfoHideTimer();
      clearCreateHideTimer();
      clearSubmissionSuccessTimer();
    };
  }, [clearCreateHideTimer, clearInfoCloseTimer, clearInfoHideTimer, clearSubmissionSuccessTimer]);

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
    if (!showCreateModal) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showCreateModal]);

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

      if (showCreateModal) {
        requestCloseCreateModal();
      }
    };

    window.addEventListener("keydown", handleEscapeClose);
    return () => {
      window.removeEventListener("keydown", handleEscapeClose);
    };
  }, [closeInfoModal, infoModalMode, requestCloseCreateModal, showCreateModal, showInfoModal]);

  const shouldHideWalletAction = showCreateModal && !isCreateModalClosing;
  const createTopActionTooltip = createModalStep === "review" ? "Back" : isCreateDraftListOpen ? "Hide drafts" : "Load drafts";
  const createTopActionLabel = createModalStep === "review" ? "Back to compose step" : isCreateDraftListOpen ? "Hide saved drafts" : "Load saved drafts";
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
      {submissionSuccessPreimage && (
        <>
          <p className="mt-3 text-gray-900 font-semibold text-xs">Randomness preimage</p>
          <p className="text-xs text-amber-600 mt-1">
            You can store it if you wish — it is used to distribute raffle rewards.
          </p>
          <p className="create-info-constraint-item text-gray-500 font-mono break-all text-xs mt-1">
            {submissionSuccessPreimage}
          </p>
        </>
      )}
    </div>
  ) : infoModalMode === "ticket-buy-success" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label" style={{ color: "#16a34a" }}>Buy Successful</p>
      <p className="create-info-constraint-item text-gray-500 font-mono break-all">
        <span className="text-gray-400">txhash: </span>
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
  ) : infoModalMode === "discard-comment-confirm" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">Discard comment?</p>
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
  ) : infoModalMode === "ticket-purchase" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">How many tickets?</p>
      {ticketPurchaseError ? (
        <p className={`create-info-constraint-item ${isPurchasingTickets ? "text-gray-500" : "text-red-500"}`}>
          <span>{ticketPurchaseError}</span>
        </p>
      ) : null}
    </div>
  ) : infoModalMode === "raffle-settlement" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">{settlementModalData?.campaignTitle ?? "Raffle settlement"}</p>
      <p className="mt-3 text-gray-900 font-semibold">Evidence:</p>
      {isLoadingSettlementModal ? (
        <div className="create-info-skeleton-list" aria-hidden="true">
          <span className="create-info-skeleton-line" />
          <span className="create-info-skeleton-line" />
          <span className="create-info-skeleton-line" />
        </div>
      ) : (
        <>
          <table className="create-info-settlement-evidence-table text-gray-500">
            <tbody>
              {(settlementModalData?.evidenceItems ?? []).map((item, index) => {
                const separatorIndex = item.indexOf(": ");
                const key = separatorIndex === -1 ? item : item.slice(0, separatorIndex);
                const value = separatorIndex === -1 ? "" : item.slice(separatorIndex + 2);

                return (
                  <tr
                    key={item}
                    className="create-info-settlement-evidence-row create-info-typed-line"
                    style={{ animationDelay: `${index * 90}ms` }}
                  >
                    <td className="create-info-settlement-evidence-key">{value ? `${key}:` : key}</td>
                    <td className="create-info-settlement-evidence-value">{value}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-gray-900 font-semibold">Recipients:</p>
          {(settlementModalData?.recipients ?? []).length > 0 ? (
            (settlementModalData?.recipients ?? []).map((recipient, index) => {
              const isConnectedRecipient = walletAddress.trim().toLowerCase() === recipient.address.trim().toLowerCase();

              return (
                <div
                  key={`${recipient.address}-${index}`}
                  className={`create-info-constraint-item create-info-settlement-recipient-row font-mono create-info-typed-line ${isConnectedRecipient ? "create-info-settlement-recipient-current" : "text-gray-500"}`}
                  style={{ animationDelay: `${((settlementModalData?.evidenceItems ?? []).length + index) * 90}ms` }}
                >
                  <span className="create-info-settlement-recipient-handle">
                    {recipient.handle}
                    {isConnectedRecipient ? <span className="create-info-settlement-recipient-you"> (You)</span> : null}
                  </span>
                  <span className="create-info-settlement-recipient-amount">{recipient.amountLabel}</span>
                </div>
              );
            })
          ) : (
            <p className="create-info-constraint-item text-gray-500">
              <span>No recipients found.</span>
            </p>
          )}
          {settlementModalData?.errorMessage ? (
            <>
              <p className="mt-3 text-red-500 font-semibold">Errors:</p>
              <p className="create-info-constraint-item text-red-500 break-words">
                <span>{settlementModalData.errorMessage}</span>
              </p>
            </>
          ) : null}
        </>
      )}
      {settlementModalData?.distributionTxHash ? (
        <>
          <p className="mt-3 text-gray-900 font-semibold">Distribution tx:</p>
          <p className="create-info-constraint-item text-gray-500 font-mono break-all">
            <span>{settlementModalData.distributionTxHash}</span>
          </p>
        </>
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
          {previewError && (
            <>
              <p className="mt-3 text-red-500 font-semibold">Errors</p>
              <p className="create-info-constraint-item text-red-500">
                <span>{previewError}</span>
              </p>
            </>
          )}
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
                {passed && (
                  <span className="create-info-constraint-check" aria-hidden="true">
                    <CheckCircle size={14} strokeWidth={2.4} />
                  </span>
                )}
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
          {!signer && <p className="mt-3 text-yellow-600 font-semibold">Info: Wallet not connected.</p>}
        </>
      )}
    </div>
  ) : (
    <div className="create-info-constraints-copy">
      <p>{HOME_INFO_MOUNTABLES_HEADING}</p>
      {HOME_INFO_MOUNTABLES_ITEMS.map((item) => (
        <p key={item} className="create-info-constraint-item">
          <span>{item}</span>
        </p>
      ))}
      <p className="mt-3">{HOME_INFO_TYPES_HEADING}</p>
      {HOME_INFO_TYPE_ITEMS.map((item) => (
        <p key={item} className="create-info-constraint-item">
          <span>{item}</span>
        </p>
      ))}
      {submissionErrorMessage ? (
        <>
          <p className="mt-3 text-red-500 font-semibold">Errors:</p>
          <p className="create-info-constraint-item text-red-500 break-words">
            <span>{submissionErrorMessage}</span>
          </p>
        </>
      ) : null}
    </div>
  );
  const infoModalActions = infoModalMode === "ticket-purchase" ? (
    <form
      className="create-info-confirm-actions"
      onSubmit={(event) => {
        event.preventDefault();
        void handleTicketPurchaseSubmit();
      }}
    >
      <input
        type="number"
        min="1"
        step="1"
        inputMode="numeric"
        value={ticketPurchaseQuantity}
        onChange={(event) => {
          setTicketPurchaseQuantity(event.target.value);
          if (ticketPurchaseError) {
            setTicketPurchaseError("");
          }
        }}
        onFocus={(event) => {
          if (event.currentTarget.value.length > 0) {
            event.currentTarget.select();
          }
        }}
        className="create-info-ticket-input"
        aria-label="Number of tickets"
        disabled={isPurchasingTickets}
      />
      <button
        type="submit"
        className="create-info-confirm-btn create-info-confirm-btn-primary"
        disabled={isPurchasingTickets}
      >
        {isPurchasingTickets ? "Processing..." : "Continue"}
      </button>
    </form>
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
  ) : infoModalMode === "discard-comment-confirm" ? (
    <div className="create-info-confirm-actions">
      <button
        type="button"
        className="create-info-confirm-btn"
        onClick={() => void handleCommentDiscardChoice(false)}
      >
        No
      </button>
      <button
        type="button"
        className="create-info-confirm-btn create-info-confirm-btn-primary"
        onClick={() => void handleCommentDiscardChoice(true)}
      >
        Yes
      </button>
    </div>
  ) : undefined;

  return (
    <main className="flex flex-col items-center min-h-screen gap-6 p-4 sm:p-8">
      <div className="campaign-shell-width flex flex-col gap-6 pt-16">
        <div
          className="campaign-shell-header campaign-shell-width fixed top-8 left-4 right-4 z-[70] mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
          onClick={showCreateModal ? (event) => {
            if (event.target === event.currentTarget) {
              requestCloseCreateModal();
            }
          } : undefined}
        >
          <div className="header-info-wrap" onClick={(event) => event.stopPropagation()}>
            <div onMouseEnter={() => openInfoModalFromHover(infoModalMode === "save-draft-confirm")} onMouseLeave={() => scheduleCloseInfoModal(infoModalMode === "save-draft-confirm" || (infoModalMode === "ticket-purchase" && isPurchasingTickets), () => {
                setInfoModalMode("about");
                setSaveDraftPromptError("");
                setSubmissionSuccessTxHash("");
                setSubmissionSuccessPreimage(null);
                setSubmissionErrorMessage("");
                setSettlementModalData(null);
                setIsLoadingSettlementModal(false);
                resetTicketPurchaseState();
              })}>
              <button
                ref={headerInfoButtonRef}
                type="button"
                className="header-info-btn"
                aria-label="Open Freight information"
                onClick={() => toggleInfoModal(infoModalMode === "save-draft-confirm" || (infoModalMode === "ticket-purchase" && isPurchasingTickets))}
                onFocus={() => openInfoModalFromHover(infoModalMode === "save-draft-confirm")}
                onBlur={() => scheduleCloseInfoModal(infoModalMode === "save-draft-confirm" || (infoModalMode === "ticket-purchase" && isPurchasingTickets), () => {
                setInfoModalMode("about");
                setSaveDraftPromptError("");
                setSubmissionSuccessTxHash("");
                setSubmissionSuccessPreimage(null);
                setSubmissionErrorMessage("");
                setSettlementModalData(null);
                setIsLoadingSettlementModal(false);
                resetTicketPurchaseState();
              })}
              >
                <span className="header-info-inner-ring" aria-hidden="true" />
                <span className="header-info-glyph" aria-hidden="true">i</span>
              </button>
            </div>
          </div>

          <div className="header-right-actions" onClick={(event) => event.stopPropagation()}>
            {showCreateModal && (
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
            )}

            <div className={`wallet-action-slot ${shouldHideWalletAction ? "wallet-action-slot-hidden" : ""}`}>
              {signer ? (
                <div
                  className="wallet-info-wrap"
                  onMouseEnter={keepWalletInfoModalOpen}
                  onMouseLeave={scheduleWalletInfoModalClose}
                >
                  <button
                    onClick={disconnect}
                    className="px-4 py-2 rounded-full overflow-hidden font-semibold text-sm btn-wallet w-full sm:w-auto"
                  >
                    Disconnect
                  </button>
                  {showWalletInfoModal && (
                    <div
                      className={`wallet-info-modal ${isWalletInfoClosing ? "wallet-info-modal-closing" : ""}`}
                      role="dialog"
                      aria-label="Wallet details"
                      onMouseEnter={keepWalletInfoModalOpen}
                      onMouseLeave={scheduleWalletInfoModalClose}
                    >
                      <div className="wallet-info-section">
                        <span className="wallet-info-label">Address</span>
                        <div className="wallet-info-address-row">
                          <span className="wallet-info-address">{walletAddressDisplay || "Loading…"}</span>
                          <button
                            type="button"
                            className="wallet-info-copy-btn"
                            onClick={() => void handleCopyWalletAddress()}
                            title={walletAddress}
                            aria-label="Copy wallet address"
                          >
                            <Copy size={14} strokeWidth={2} aria-hidden="true" />
                          </button>
                        </div>
                        {walletCopyFeedback === "copied" ? <span className="wallet-info-feedback">Copied</span> : null}
                        {walletCopyFeedback === "error" ? <span className="wallet-info-feedback wallet-info-feedback-error">Copy failed</span> : null}
                      </div>
                      <div className="wallet-info-grid">
                        <div className="wallet-info-section">
                          <span className="wallet-info-label">Balance</span>
                          <span className={`wallet-info-usd ${walletBalanceIncreasing ? "wallet-balance-increasing" : ""}`.trim()}>
                            <span className="wallet-info-usd-currency">$</span>
                            <span>{walletUsdParts?.whole ?? "--"}</span>
                            <span className="wallet-info-usd-decimals">{walletUsdParts ? walletUsdParts.decimals : "--"}</span>
                          </span>
                          <span className="wallet-info-value">
                            {walletBalance !== null ? `${formatCkbAmount(walletBalance)} CKB` : walletInfoLoading ? "Loading…" : "--"}
                          </span>
                        </div>
                        <div className="wallet-info-section">
                          <span className="wallet-info-label">Chain</span>
                          <span className="wallet-info-value wallet-chain-indicator">{walletChainLabel}</span>
                        </div>
                      </div>
                      {walletInfoError ? <p className="wallet-info-error">{walletInfoError}</p> : null}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={open}
                  className="px-4 py-2 rounded-full overflow-hidden font-semibold text-sm btn-wallet w-full sm:w-auto"
                >
                  Connect Wallet
                </button>
              )}
            </div>
          </div>

          <FreightInfoModal
            open={showInfoModal}
            closing={isInfoModalClosing}
            ariaLabel={infoModalMode === "submission-success" ? "Submission successful" : infoModalMode === "ticket-buy-success" ? "Buy successful" : infoModalMode === "submission-error" ? "Transaction error" : infoModalMode === "ticket-purchase" ? "Buy raffle tickets" : infoModalMode === "raffle-settlement" ? "Raffle settlement details" : "Freight information modal"}
            body={infoModalBody}
            actions={infoModalActions}
            backdropAriaLabel={infoModalMode === "save-draft-confirm" ? "Return to create freight modal" : infoModalMode === "ticket-purchase" ? "Close ticket purchase modal" : infoModalMode === "raffle-settlement" ? "Close raffle settlement modal" : "Close Freight information modal"}
            backdropInteractive={infoModalInteraction === "click" || infoModalMode === "save-draft-confirm" || infoModalMode === "submission-success" || infoModalMode === "ticket-purchase" || infoModalMode === "raffle-settlement"}
            onRequestClose={() => closeInfoModal(() => {
              setInfoModalMode("about");
              setSaveDraftPromptError("");
              setSubmissionSuccessTxHash("");
              setSubmissionSuccessPreimage(null);
              setSubmissionErrorMessage("");
              setSettlementModalData(null);
              setIsLoadingSettlementModal(false);
            })}
            onKeepOpen={keepInfoModalOpen}
            onScheduleClose={() => scheduleCloseInfoModal(infoModalMode === "save-draft-confirm" || (infoModalMode === "ticket-purchase" && isPurchasingTickets), () => {
              setInfoModalMode("about");
              setSaveDraftPromptError("");
              setSubmissionSuccessTxHash("");
              setSubmissionSuccessPreimage(null);
              setSubmissionErrorMessage("");
              setSettlementModalData(null);
              setIsLoadingSettlementModal(false);
              resetTicketPurchaseState();
            })}
          />
        </div>

        {signer && (
          <div className="retro-mountables-panel p-3 rounded-lg border border-gray-200">
            <MountablesPanel />
          </div>
        )}

        <CampaignFeedSection
          client={client}
          onCommentDiscardRequest={handleCommentDiscardRequest}
          commentDiscardDecision={commentDiscardDecision}
          onTicketPurchaseRequest={handleOpenTicketPurchaseInfoModal}
          onErrorChange={handleFreightsLoadError}
          onSettlementInfoRequest={(data) => {
            setSettlementModalData(data);
            setIsLoadingSettlementModal(false);
            setInfoModalMode("raffle-settlement");
            setInfoModalInteraction("click");
            setIsInfoModalClosing(false);
            setShowInfoModal(true);
          }}
        />
      </div>

      {showCreateModal && (
        <button
          type="button"
          className={`create-campaign-backdrop ${isCreateModalClosing ? "create-campaign-backdrop-closing" : ""}`}
          aria-label="Close create freight modal"
          onClick={requestCloseCreateModal}
        />
      )}

      {showCreateModal && (
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
      )}

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

