"use client";

import {
  Check,
  CheckCircle,
  DollarSign,
  LockKeyhole,
  Scroll,
} from "lucide-react";
import { ccc } from "@ckb-ccc/connector-react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from "react";

import AppShellHeader from "@/app/_components/AppShellHeader";
import CampaignFeedSection from "@/app/_components/CampaignFeedSection";
import CreateCampaignHeaderActions from "@/app/_components/CreateCampaignHeaderActions";
import CreateCampaignLauncher from "@/app/_components/CreateCampaignLauncher";
import MountablesPanel from "@/app/_components/MountablesPanel";
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
import { useCreateCampaignFlow } from "@/app/_hooks/useCreateCampaignFlow";
import { useInfoModalState } from "@/app/_hooks/useInfoModalState";
import { type CampaignRecord } from "@/app/_hooks/useCampaignFeed";
import { useTicketPurchaseFlow } from "@/app/_hooks/useTicketPurchaseFlow";
import { useUserProfile } from "@/app/_hooks/useUserProfile";
import { useWalletInfo } from "@/app/_hooks/useWalletInfo";
import type { SettlementModalData } from "@/app/_types/settlement";
import { buildDefaultUsername, formatCkbAmount } from "@/lib/campaignDisplay";
import { markWalletSeedIntent } from "@/lib/walletSeed";
import { type CampaignCell } from "@/lib/transactions";

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
type InfoModalMode = "about" | "mountables" | "mountables-forms" | "save-draft-confirm" | "submission-success" | "ticket-buy-success" | "submission-error" | "discard-comment-confirm" | "ticket-purchase" | "raffle-settlement";

const DETAIL_CONTRACTING_FLAG = "freight:detail-contracting";

export default function Home() {
  const { open, disconnect, client } = ccc.useCcc();
  const openWalletWithSeed = useCallback(() => {
    markWalletSeedIntent();
    open();
  }, [open]);
  const signer = ccc.useSigner();
  const router = useRouter();
  const INFO_MODAL_ANIMATION_MS = 620;
  const [infoModalMode, setInfoModalMode] = useState<InfoModalMode>("about");
  const [pendingCommentDiscardId, setPendingCommentDiscardId] = useState<string | null>(null);
  const [commentDiscardDecision, setCommentDiscardDecision] = useState<{ cardId: string; discard: boolean } | null>(null);
  const [submissionErrorMessage, setSubmissionErrorMessage] = useState("");
  const [settlementModalData, setSettlementModalData] = useState<SettlementModalData | null>(null);
  const [shellWidthClass, setShellWidthClass] = useState("campaign-shell-width");
  const [isLoadingSettlementModal, setIsLoadingSettlementModal] = useState(false);
  const handleFreightsLoadError = useCallback((message: string) => {
    setSubmissionErrorMessage(message);
  }, []);

  useLayoutEffect(() => {
    const shouldContractFromDetail = sessionStorage.getItem(DETAIL_CONTRACTING_FLAG) === "1";

    if (shouldContractFromDetail) {
      sessionStorage.removeItem(DETAIL_CONTRACTING_FLAG);
      setShellWidthClass("campaign-shell-width-md");
      const frameId = window.requestAnimationFrame(() => {
        setShellWidthClass("campaign-shell-width");
      });

      return () => {
        window.cancelAnimationFrame(frameId);
      };
    }
  }, []);

  const [showWalletInfoModal, setShowWalletInfoModal] = useState(false);
  const [isWalletInfoClosing, setIsWalletInfoClosing] = useState(false);
  const walletInfoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletInfoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerInfoButtonRef = useRef<HTMLButtonElement>(null);
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
  const { currentUserProfile } = useUserProfile(signer ?? null);
  const walletActionHref = useMemo(() => {
    const nextUsername = currentUserProfile?.username?.trim() || (walletAddress ? buildDefaultUsername(walletAddress) : "");
    return nextUsername ? `/user/${encodeURIComponent(nextUsername)}` : undefined;
  }, [currentUserProfile?.username, walletAddress]);

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
    keepInfoModalOpen,
  } = useInfoModalState({
    animationMs: INFO_MODAL_ANIMATION_MS,
    onResetState: () => {},
  });

  const {
    constraintStatus,
    createModalContentRef,
    createModalStep,
    createResetSignal,
    createStepBackSignal,
    finalizeCloseCreateModal,
    formsMountableSelected,
    handleCreateTopRightAction,
    handleDraftSelectionRequest,
    handleSaveDraftChoice,
    isCreateDraftListOpen,
    isCreateModalClosing,
    isMountableFormFocused,
    isMountablesContinuing,
    mountableFormLinks,
    mountableFormValidationState,
    mountablesPromptError,
    openCreateModal,
    openMountablesModal,
    openSubmissionSuccessInfoModal,
    previewError,
    requestCloseCreateModal,
    resetCreateModal,
    saveDraftPromptError,
    setConstraintStatus,
    setCreateModalStep,
    setFormsMountableSelected,
    setIsCreateDraftListOpen,
    setIsMountableFormFocused,
    setIsMountablesContinuing,
    setMountableFormLinks,
    setMountableFormValidationState,
    setMountablesPromptError,
    setPreviewError,
    setSaveDraftPromptError,
    setSubmissionSuccessPreimage,
    setSubmissionSuccessTxHash,
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
  }, [clearInfoCloseTimer, clearInfoHideTimer, clearSubmissionSuccessTimer, closeInfoModal, setInfoModalInteraction, setIsInfoModalClosing, setShowInfoModal, setSubmissionSuccessTxHash, submissionSuccessTimerRef]);

  const {
    handleTicketPurchaseSubmit,
    isPurchasingTickets,
    openTicketPurchaseInfoModal,
    resetTicketPurchaseState,
    setTicketPurchaseError,
    setTicketPurchaseQuantity,
    ticketPurchaseError,
    ticketPurchaseQuantity,
  } = useTicketPurchaseFlow({
    onSubmissionError: setSubmissionErrorMessage,
    onTicketBuySuccess: openTicketBuySuccessInfoModal,
  });

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

  useEffect(() => {
    return () => {
      clearInfoCloseTimer();
      clearInfoHideTimer();
      clearSubmissionSuccessTimer();
    };
  }, [clearInfoCloseTimer, clearInfoHideTimer, clearSubmissionSuccessTimer]);


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
            <a
              href={`https://pudge.explorer.nervos.org/transaction/${settlementModalData.distributionTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {settlementModalData.distributionTxHash}
            </a>
          </p>
        </>
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
          className="create-mountable-option"
          data-tooltip="Lock"
          disabled
          aria-label="Lock mountable coming soon"
        >
          <span className="create-mountable-option-icon-wrap">
            <span className="create-mountable-option-icon-bg">
              <LockKeyhole size={18} strokeWidth={2} aria-hidden="true" />
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
  ) : showCreateModal && isCreateDraftListOpen ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">Drafts:</p>
      <p className="create-info-constraint-item text-gray-500">
        <span>Nothing much for now. Each draft can only last a maximum of 20 days.</span>
      </p>
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
          <p className="font-semibold">{CREATE_INFO_CONSTRAINT_HEADING}</p>
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
          {!signer && <p className="mt-3 text-yellow-600 font-semibold">Info: Wallet not connected.</p>}
        </>
      )}
    </div>
  ) : (
    <div className="create-info-constraints-copy">
      <p className="font-semibold">{HOME_INFO_MOUNTABLES_HEADING}</p>
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
  ) : showCreateModal && infoModalMode === "mountables" ? (
    <div className="create-info-confirm-actions">
      <button
        type="button"
        className="create-info-confirm-btn create-info-confirm-btn-primary"
        onClick={() => {
          if (!formsMountableSelected) {
            setMountablesPromptError("Select a mountable to continue.");
            return;
          }

          transitionMountablesModal("mountables-forms");
          setMountablesPromptError("");
        }}
      >
        Continue
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
      <div className={`${shellWidthClass} flex flex-col gap-6 pt-[3.75rem] sm:pt-[2.625rem]`.trim()}>
        <AppShellHeader
          className={`campaign-shell-header ${shellWidthClass} ${showCreateModal ? "campaign-shell-header-transparent" : ""} fixed top-0 left-4 right-4 z-[70] mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`.trim()}
          infoButtonAriaLabel="Open Freight information"
          infoModalAriaLabel={infoModalMode === "submission-success" ? "Submission successful" : infoModalMode === "ticket-buy-success" ? "Buy successful" : infoModalMode === "submission-error" ? "Transaction error" : infoModalMode === "ticket-purchase" ? "Buy raffle tickets" : infoModalMode === "raffle-settlement" ? "Raffle settlement details" : "Freight information modal"}
          infoModalBackdropAriaLabel={infoModalMode === "save-draft-confirm" ? "Return to create freight modal" : infoModalMode === "ticket-purchase" ? "Close ticket purchase modal" : infoModalMode === "raffle-settlement" ? "Close raffle settlement modal" : "Close Freight information modal"}
          infoModalBackdropInteractive={infoModalInteraction === "click" || infoModalMode === "save-draft-confirm" || infoModalMode === "submission-success" || infoModalMode === "ticket-purchase" || infoModalMode === "raffle-settlement"}
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
          onInfoButtonBlur={() => scheduleCloseInfoModal(infoModalMode === "save-draft-confirm" || infoModalMode === "mountables" || infoModalMode === "mountables-forms" || (infoModalMode === "ticket-purchase" && isPurchasingTickets), () => {
            setInfoModalMode("about");
            setSaveDraftPromptError("");
            setSubmissionSuccessTxHash("");
            setSubmissionSuccessPreimage(null);
            setSubmissionErrorMessage("");
            setSettlementModalData(null);
            setIsLoadingSettlementModal(false);
            resetTicketPurchaseState();
          })}
          onInfoButtonClick={() => router.push("/")}
          onInfoButtonFocus={() => openInfoModalFromHover(infoModalMode === "save-draft-confirm" || infoModalMode === "mountables" || infoModalMode === "mountables-forms")}
          onInfoModalKeepOpen={keepInfoModalOpen}
          onInfoModalRequestClose={() => closeInfoModal(() => {
            setInfoModalMode("about");
            setSaveDraftPromptError("");
            setSubmissionSuccessTxHash("");
            setSubmissionSuccessPreimage(null);
            setSubmissionErrorMessage("");
            setSettlementModalData(null);
            setIsLoadingSettlementModal(false);
          })}
          onInfoModalScheduleClose={() => scheduleCloseInfoModal(infoModalMode === "save-draft-confirm" || infoModalMode === "mountables" || infoModalMode === "mountables-forms" || (infoModalMode === "ticket-purchase" && isPurchasingTickets), () => {
            setInfoModalMode("about");
            setSaveDraftPromptError("");
            setSubmissionSuccessTxHash("");
            setSubmissionSuccessPreimage(null);
            setSubmissionErrorMessage("");
            setSettlementModalData(null);
            setIsLoadingSettlementModal(false);
            resetTicketPurchaseState();
          })}
          onInfoMouseEnter={() => openInfoModalFromHover(infoModalMode === "save-draft-confirm" || infoModalMode === "mountables" || infoModalMode === "mountables-forms")}
          onInfoMouseLeave={() => scheduleCloseInfoModal(infoModalMode === "save-draft-confirm" || infoModalMode === "mountables" || infoModalMode === "mountables-forms" || (infoModalMode === "ticket-purchase" && isPurchasingTickets), () => {
            setInfoModalMode("about");
            setSaveDraftPromptError("");
            setSubmissionSuccessTxHash("");
            setSubmissionSuccessPreimage(null);
            setSubmissionErrorMessage("");
            setSettlementModalData(null);
            setIsLoadingSettlementModal(false);
            resetTicketPurchaseState();
          })}
          onInfoWrapClick={(event) => event.stopPropagation()}
          onWalletActionClick={closeWalletInfoModal}
          onRightActionsClick={(event) => event.stopPropagation()}
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
          shouldHideWalletAction={shouldHideWalletAction}
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
          walletActionLabel="Introspect"
        />

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

      <CreateCampaignLauncher
        createModalContentRef={createModalContentRef}
        createResetSignal={createResetSignal}
        createStepBackSignal={createStepBackSignal}
        onConstraintStatusChange={setConstraintStatus}
        onDraftListOpenChange={setIsCreateDraftListOpen}
        onDraftSelectionRequest={handleDraftSelectionRequest}
        onMountableSelectionRequired={openMountablesModal}
        onMountableSelectionStateChange={({ hasMountedHashtag, formsSelected }) => {
          setFormsMountableSelected(formsSelected);
          if (!hasMountedHashtag) {
            setMountablesPromptError("");
          }
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

