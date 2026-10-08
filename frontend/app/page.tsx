"use client";

import { CheckCircle, LoaderCircle } from "lucide-react";
import { ccc } from "@ckb-ccc/connector-react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from "react";

import AppShellHeader from "@/app/_components/AppShellHeader";
import CampaignFeedSection from "@/app/_components/CampaignFeedSection";
import CreateCampaignHeaderActions from "@/app/_components/CreateCampaignHeaderActions";
import CreateCampaignLauncher from "@/app/_components/CreateCampaignLauncher";
import CreateReviewMountablesInfo from "@/app/_components/CreateReviewMountablesInfo";
import FreightMountablesInfo from "@/app/_components/FreightMountablesInfo";
import FreightTreeDiagram from "@/app/_components/FreightTreeDiagram";
import FreightTreeHelpInfo from "@/app/_components/FreightTreeHelpInfo";
import FreightTreeZoomActions from "@/app/_components/FreightTreeZoomActions";
import RaffleSettlementInfo from "@/app/_components/RaffleSettlementInfo";
import type { FreightTree } from "@/app/_components/FreightTreeInfo";
import { ChildFreightMountableConfigurator, FormsMountableConfigurator, LockMountableConfigurator } from "@/app/_components/BuiltInMountableConfigurator";
import MountableAppsConfigurator from "@/app/_components/MountableAppsConfigurator";
import MountableOptionsCatalog from "@/app/_components/MountableOptionsCatalog";
import MountablesPanel from "@/app/_components/MountablesPanel";
import TagSuggestionsInfo from "@/app/_components/TagSuggestionsInfo";
import {
  CREATE_INFO_CONSTRAINT_HEADING,
  CREATE_INFO_CONSTRAINT_ITEMS,
  CREATE_INFO_NOTE_HEADING,
  CREATE_INFO_NOTE_ITEMS,
  CREATE_INFO_PREVIEW_HEADING,
  CREATE_INFO_RAFFLE_SUPPORT_NOTE,
  CREATE_INFO_TYPING_HEADING,
  CREATE_INFO_TYPING_ITEMS,
} from "@/app/_lib/createCampaignInfo";
import { getLockMountableValidationState, parseLockMinimumFbars } from "@/app/_lib/lockMountable";
import { useCreateCampaignFlow } from "@/app/_hooks/useCreateCampaignFlow";
import { useInfoModalState } from "@/app/_hooks/useInfoModalState";
import { type CampaignRecord } from "@/app/_hooks/useCampaignFeed";
import { markProfileAnalyticsDirty } from "@/app/_hooks/useProfileAnalytics";
import { markProfileFreightsDirty } from "@/app/_hooks/useProfileFreights";
import { markProfileTransactionsDirty } from "@/app/_hooks/useProfileTransactions";
import { useTicketPurchaseFlow } from "@/app/_hooks/useTicketPurchaseFlow";
import { useUserProfile } from "@/app/_hooks/useUserProfile";
import { useWalletInfo } from "@/app/_hooks/useWalletInfo";
import type { CampaignSupportRequest } from "@/app/_types/campaignSupport";
import type { SettlementModalData } from "@/app/_types/settlement";
import { buildDefaultUsername, formatCkbAmount } from "@/lib/campaignDisplay";
import { FREIGHT_CREATION_FBARS_COST } from "@/lib/fbars";
import { markWalletSeedIntent } from "@/lib/walletSeed";
import { type CampaignCell } from "@/lib/transactions";

const HOME_INFO_MOUNTABLES_HEADING = "Mountables:";
const HOME_INFO_MOUNTABLES_ITEMS = ["These are apps mounted on (or as) freights."];
const HOME_INFO_TYPES_HEADING = "Freight types:";
const INSUFFICIENT_FBARS_MESSAGE = "Interact more on chain to improve FBARS.";
const HOME_INFO_TYPE_ITEMS = [
  "1. Simple Task — a basic freight for posting a task without pooled deposits.",
  "2. Funded Task — a task funded up front so rewards can be distributed from the pool.",
  "3. Crowdfunding — an open funding freight where supporters deposit toward a shared pool.",
  "4. Timed Challenge — a challenge with a defined start and end window.",
  "5. Raffle — a ticket-based freight where entrants buy tickets for a randomized outcome.",
  "6. Recurring Raffle — a multi-round raffle with winner cash-out windows and a shrinking winner set.",
];


  // Add a new mode for ticket purchase success (separate from generic submission-success)
type InfoModalMode = "about" | "marquee-edit" | "create-error" | "tag-suggestions" | "freight-mountables" | "freight-options" | "freight-relation-choice" | "freight-existing" | "freight-link-pending" | "freight-link-success" | "freight-link-error" | "mountables" | "mountables-child-freight" | "mountables-forms" | "mountables-lock" | "mountables-apps" | "save-draft-confirm" | "submission-success" | "ticket-buy-success" | "creator-withdraw-success" | "support-deposit" | "support-deposit-success" | "submission-error" | "discard-comment-confirm" | "ticket-purchase" | "raffle-settlement" | "insufficient-fbars";
type FreightRelationChoice = "parent" | "child";
type OwnedFreight = { campaignId: string; title: string };

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
  const [selectedFreightMountablesRecord, setSelectedFreightMountablesRecord] = useState<CampaignRecord | null>(null);
  const [selectedFreightOptionsId, setSelectedFreightOptionsId] = useState<string | null>(null);
  const [freightRelationChoice, setFreightRelationChoice] = useState<FreightRelationChoice | null>(null);
  const [isCreatingRelatedFreight, setIsCreatingRelatedFreight] = useState(false);
  const [ownedFreights, setOwnedFreights] = useState<OwnedFreight[]>([]);
  const [ownedFreightsLoading, setOwnedFreightsLoading] = useState(false);
  const [freightLinkBusy, setFreightLinkBusy] = useState(false);
  const [freightLinkError, setFreightLinkError] = useState("");
  const [pendingNewFreightId, setPendingNewFreightId] = useState<string | null>(null);
  const [freightTree, setFreightTree] = useState<FreightTree | null>(null);
  const [freightTreeFeedback, setFreightTreeFeedback] = useState("");
  const [freightTreeError, setFreightTreeError] = useState(false);
  const [isLoadingFreightTree, setIsLoadingFreightTree] = useState(false);
  const [showFreightTree, setShowFreightTree] = useState(false);
  const [isFreightTreeClosing, setIsFreightTreeClosing] = useState(false);
  const [freightTreeZoom, setFreightTreeZoom] = useState(0.75);
  const freightTreeCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoStepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const freightTreeRequestRef = useRef<AbortController | null>(null);
  const [commentDiscardDecision, setCommentDiscardDecision] = useState<{ cardId: string; discard: boolean } | null>(null);
  const [submissionErrorMessage, setSubmissionErrorMessage] = useState("");
  const [settlementModalData, setSettlementModalData] = useState<SettlementModalData | null>(null);
  const [shellWidthClass, setShellWidthClass] = useState("campaign-shell-width");
  const [isLoadingSettlementModal, setIsLoadingSettlementModal] = useState(false);
  const [supportRequest, setSupportRequest] = useState<CampaignSupportRequest | null>(null);
  const [supportAmount, setSupportAmount] = useState("");
  const [supportError, setSupportError] = useState("");
  const [isProcessingSupport, setIsProcessingSupport] = useState(false);
  const [marqueeDraft, setMarqueeDraft] = useState("");
  const [marqueeError, setMarqueeError] = useState("");
  const [referenceQuote, setReferenceQuote] = useState<string | null>(null);
  const handleFreightsLoadError = useCallback((message: string) => {
    setSubmissionErrorMessage(message);
  }, []);

  useLayoutEffect(() => {
    const shouldContractFromDetail = sessionStorage.getItem(DETAIL_CONTRACTING_FLAG) === "1";

    if (!shouldContractFromDetail) {
      setShellWidthClass("campaign-shell-width");
      return;
    }

    sessionStorage.removeItem(DETAIL_CONTRACTING_FLAG);
    setShellWidthClass("campaign-shell-width-md");
    const timeoutId = window.setTimeout(() => {
      setShellWidthClass("campaign-shell-width");
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
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
  const {
    activeWeeklyMarqueeMessage,
    currentUserProfile,
    isSavingUserProfile,
    saveLightModePrimaryColor,
    saveWeeklyMarqueeMessage,
    userProfileError,
  } = useUserProfile(signer ?? null);
  const walletActionHref = useMemo(() => {
    const nextUsername = currentUserProfile?.username?.trim() || (walletAddress ? buildDefaultUsername(walletAddress) : "");
    return nextUsername ? `/user/${encodeURIComponent(nextUsername)}` : undefined;
  }, [currentUserProfile?.username, walletAddress]);
  const canEditLightModePrimaryColor = Boolean(signer && walletAddress && currentUserProfile?.address === walletAddress);
  const markCurrentProfileDataDirty = useCallback(() => {
    const nextAddress = currentUserProfile?.address ?? walletAddress ?? null;
    const nextHandle = currentUserProfile?.username ?? null;
    const dirtyArgs = {
      address: nextAddress,
      handle: nextAddress ? null : nextHandle,
    };

    markProfileAnalyticsDirty(dirtyArgs);
    markProfileFreightsDirty(dirtyArgs);
    markProfileTransactionsDirty(dirtyArgs);
  }, [currentUserProfile?.address, currentUserProfile?.username, walletAddress]);

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
    advanceMountableSetup,
    beginMountableSetup,
    constraintStatus,
    createModalContentRef,
    createModalStep,
    createResetSignal,
    createStepBackSignal,
    finalizeCloseCreateModal,
    formsMountableSelected,
    childFreightMountableSelected,
    handleCreateTopRightAction,
    handleCreateErrorChange,
    handleDraftSelectionRequest,
    handleMountableSelectionStateChange,
    handleSaveDraftChoice,
    handleToggleSelectedMountablePrinciple,
    handleUpdateSelectedMountablePrincipleParam,
    handleToggleMountableAppSelection,
    handleTagSuggestionsRequested,
    handleTagSuggestionContinue,
    handleVerifySelectedMountableApp,
    isCreateDraftListOpen,
    isCreateModalClosing,
    isMountableFormFocused,
    isMountableLockFocused,
    isMountablesContinuing,
    isVerifyingMountableApp,
    lockMountableSelected,
    mountedAppConfigs,
    mountableAppsError,
    mountableFormLinks,
    mountableLockFbars,
    mountableChildFreightTitle,
    mountableLockRule,
    mountableFormValidationState,
    mountableLockValidationState,
    mountablesPromptError,
    openCreateModal,
    openMountablesModal,
    openSubmissionSuccessInfoModal,
    previewError,
    registeredMountableApps,
    requestCloseCreateModal,
    resetCreateInfoModalState,
    resetCreateModal,
    saveDraftPromptError,
    selectedMountableAppId,
    selectedMountableAppIds,
    selectedMountablePrincipleIds,
    selectedMountablePrincipleParams,
    setConstraintStatus,
    setCreateModalStep,
    setFormsMountableSelected,
    setChildFreightMountableSelected,
    setIsCreateDraftListOpen,
    setIsMountableFormFocused,
    setIsMountableLockFocused,
    setIsMountablesContinuing,
    setLockMountableSelected,
    setMountableFormLinks,
    setMountableLockFbars,
    setMountableChildFreightTitle,
    setMountableLockRule,
    setMountableFormValidationState,
    setMountableLockValidationState,
    setMountablesPromptError,
    setSubmissionSuccessTxHash,
    showCreateModal,
    submissionSuccessTxHash,
    tagSuggestionQuery,
    goBackMountableSetup,
  } = useCreateCampaignFlow<InfoModalMode>({
    animationMs: INFO_MODAL_ANIMATION_MS,
    createErrorInfoModalMode: "create-error",
    tagSuggestionsInfoModalMode: "tag-suggestions",
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

  useEffect(() => {
    const quote = sessionStorage.getItem("freight:reference-quote");
    if (!quote) return;
    sessionStorage.removeItem("freight:reference-quote");
    setReferenceQuote(quote);
    openCreateModal();
  }, [openCreateModal]);

  useEffect(() => {
    if (!showCreateModal || !referenceQuote) return;
    createModalContentRef.current?.insertReferenceQuote(referenceQuote);
    setReferenceQuote(null);
  }, [createModalContentRef, referenceQuote, showCreateModal]);

  const openTransactionSuccessInfoModal = useCallback((txHash: string, mode: "ticket-buy-success" | "creator-withdraw-success") => {
    markCurrentProfileDataDirty();
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer();
    setSubmissionErrorMessage("");
    setSubmissionSuccessTxHash(txHash);
    setInfoModalMode(mode);
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
    submissionSuccessTimerRef.current = setTimeout(() => {
      closeInfoModal();
    }, 3000);
  }, [clearInfoCloseTimer, clearInfoHideTimer, clearSubmissionSuccessTimer, closeInfoModal, markCurrentProfileDataDirty, setInfoModalInteraction, setIsInfoModalClosing, setShowInfoModal, setSubmissionSuccessTxHash, submissionSuccessTimerRef]);

  const openTicketBuySuccessInfoModal = useCallback((txHash: string) => {
    openTransactionSuccessInfoModal(txHash, "ticket-buy-success");
  }, [openTransactionSuccessInfoModal]);

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
    currentViewerFbars: currentUserProfile?.fbars,
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

  const transitionFreightInfoModal = useCallback((mode: InfoModalMode) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    if (infoStepTimerRef.current) clearTimeout(infoStepTimerRef.current);
    setIsInfoModalClosing(true);
    infoStepTimerRef.current = setTimeout(() => {
      setInfoModalMode(mode);
      setIsInfoModalClosing(false);
      setShowInfoModal(true);
      infoStepTimerRef.current = null;
    }, Math.max(120, INFO_MODAL_ANIMATION_MS - 500));
  }, [clearInfoCloseTimer, clearInfoHideTimer, setIsInfoModalClosing, setShowInfoModal]);

  const handleOpenTicketPurchaseInfoModal = useCallback((
    campaign: CampaignCell,
    record: CampaignRecord | null,
    liveSoldTickets: bigint,
    remainingTickets: bigint,
    onTicketBought: (campaignId: string, ticketPrice: bigint, nextSoldTickets: bigint) => void,
  ) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer();
    openTicketPurchaseInfoModal(campaign, record, { liveSoldTickets, remainingTickets }, onTicketBought);
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

  const handleOpenSupportInfoModal = useCallback((request: CampaignSupportRequest) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer();
    setSupportRequest(request);
    setSupportAmount("");
    setSupportError("");
    setIsProcessingSupport(false);
    setInfoModalMode("support-deposit");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearInfoCloseTimer, clearInfoHideTimer, clearSubmissionSuccessTimer, setInfoModalInteraction, setIsInfoModalClosing, setShowInfoModal]);

  const handleSupportSubmit = useCallback(async () => {
    if (!supportRequest || isProcessingSupport) return;

    setIsProcessingSupport(true);
    setSupportError("");
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    try {
      const txHash = await supportRequest.submit(supportAmount);
      markCurrentProfileDataDirty();
      setSubmissionSuccessTxHash(txHash);
      setIsProcessingSupport(false);
      transitionFreightInfoModal("support-deposit-success");
      clearSubmissionSuccessTimer();
      submissionSuccessTimerRef.current = setTimeout(() => closeInfoModal(), 3000 + Math.max(120, INFO_MODAL_ANIMATION_MS - 500));
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : "Transaction failed");
      setIsProcessingSupport(false);
    }
  }, [clearSubmissionSuccessTimer, closeInfoModal, isProcessingSupport, markCurrentProfileDataDirty, setSubmissionSuccessTxHash, submissionSuccessTimerRef, supportAmount, supportRequest, transitionFreightInfoModal]);

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

  const handleFreightMountablesClick = useCallback((record: CampaignRecord) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    setSelectedFreightMountablesRecord(record);
    setInfoModalMode("freight-mountables");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearInfoCloseTimer, clearInfoHideTimer, setInfoModalInteraction, setIsInfoModalClosing, setShowInfoModal]);

  const handleFreightOptionsClick = useCallback((campaignId: string) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    if (infoStepTimerRef.current) clearTimeout(infoStepTimerRef.current);
    freightTreeRequestRef.current?.abort();
    freightTreeRequestRef.current = null;
    setSelectedFreightOptionsId(campaignId);
    setFreightRelationChoice(null);
    setFreightTreeFeedback("");
    setFreightTreeError(false);
    setIsLoadingFreightTree(false);
    setFreightLinkError("");
    setInfoModalMode("freight-options");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearInfoCloseTimer, clearInfoHideTimer, setInfoModalInteraction, setIsInfoModalClosing, setShowInfoModal]);

  const resetHomeInfoModalState = useCallback(() => {
    if (infoStepTimerRef.current) {
      clearTimeout(infoStepTimerRef.current);
      infoStepTimerRef.current = null;
    }
    resetCreateInfoModalState();
    setSubmissionErrorMessage("");
    setSettlementModalData(null);
    setIsLoadingSettlementModal(false);
    setSelectedFreightMountablesRecord(null);
    if (!(isCreatingRelatedFreight && (showCreateModal || isCreateModalClosing) && !infoModalMode.startsWith("freight-link-"))) {
      setSelectedFreightOptionsId(null);
      setFreightRelationChoice(null);
      setIsCreatingRelatedFreight(false);
      setFreightLinkError("");
      setPendingNewFreightId(null);
      freightTreeRequestRef.current?.abort();
      freightTreeRequestRef.current = null;
      setIsLoadingFreightTree(false);
      setFreightTreeFeedback("");
      setFreightTreeError(false);
    }
    if (infoModalMode === "marquee-edit" || infoModalMode === "freight-options" || infoModalMode === "freight-relation-choice" || infoModalMode === "freight-existing" || infoModalMode.startsWith("freight-link-")) {
      setInfoModalMode("about");
    }
    setMarqueeDraft("");
    setMarqueeError("");
    setSupportRequest(null);
    setSupportAmount("");
    setSupportError("");
    setIsProcessingSupport(false);
    resetTicketPurchaseState();
  }, [infoModalMode, isCreateModalClosing, isCreatingRelatedFreight, resetCreateInfoModalState, resetTicketPurchaseState, showCreateModal]);

  const handleOpenMarqueeEditor = useCallback(() => {
    if (!currentUserProfile?.canEditWeeklyMarquee || isSavingUserProfile) return;
    clearInfoCloseTimer();
    clearInfoHideTimer();
    setMarqueeDraft(activeWeeklyMarqueeMessage ?? "");
    setMarqueeError("");
    setInfoModalMode("marquee-edit");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [activeWeeklyMarqueeMessage, clearInfoCloseTimer, clearInfoHideTimer, currentUserProfile?.canEditWeeklyMarquee, isSavingUserProfile, setInfoModalInteraction, setIsInfoModalClosing, setShowInfoModal]);

  const handleSaveMarqueeMessage = useCallback(async () => {
    if (isSavingUserProfile || !marqueeDraft.trim()) return;
    setMarqueeError("");
    try {
      await saveWeeklyMarqueeMessage(marqueeDraft.trim());
      closeInfoModal(resetHomeInfoModalState);
    } catch (error) {
      setMarqueeError(error instanceof Error ? error.message : "Failed to update weekly marquee message");
    }
  }, [closeInfoModal, isSavingUserProfile, marqueeDraft, resetHomeInfoModalState, saveWeeklyMarqueeMessage]);

  useEffect(() => () => {
    if (infoStepTimerRef.current) clearTimeout(infoStepTimerRef.current);
    freightTreeRequestRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!isCreatingRelatedFreight || showCreateModal || isCreateModalClosing) return;
    if (infoModalMode === "freight-link-pending" || infoModalMode === "freight-link-success" || infoModalMode === "freight-link-error") return;
    setIsCreatingRelatedFreight(false);
    setFreightRelationChoice(null);
    setSelectedFreightOptionsId(null);
  }, [infoModalMode, isCreateModalClosing, isCreatingRelatedFreight, showCreateModal]);

  useEffect(() => {
    if (infoModalMode !== "freight-existing" || !selectedFreightOptionsId || !walletAddress) return;
    const controller = new AbortController();
    setOwnedFreightsLoading(true);
    setFreightLinkError("");
    fetch(`/api/freights/tree?campaignId=${encodeURIComponent(selectedFreightOptionsId)}&ownedBy=${encodeURIComponent(walletAddress)}`, {
      cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      const payload = await response.json() as { freights?: OwnedFreight[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load your freights");
      if (!controller.signal.aborted) setOwnedFreights(payload.freights ?? []);
    }).catch((error) => {
      if (!controller.signal.aborted) setFreightLinkError(error instanceof Error ? error.message : "Unable to load your freights");
    }).finally(() => {
      if (!controller.signal.aborted) setOwnedFreightsLoading(false);
    });
    return () => controller.abort();
  }, [infoModalMode, selectedFreightOptionsId, walletAddress]);

  const handleViewFreightTree = useCallback(async () => {
    if (!selectedFreightOptionsId || isLoadingFreightTree) return;
    const controller = new AbortController();
    freightTreeRequestRef.current?.abort();
    freightTreeRequestRef.current = controller;
    setIsLoadingFreightTree(true);
    setFreightTreeFeedback("");
    setFreightTreeError(false);
    try {
      const response = await fetch(`/api/freights/tree?campaignId=${encodeURIComponent(selectedFreightOptionsId)}`, {
        cache: "no-store", signal: controller.signal,
      });
      const payload = await response.json() as FreightTree & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load freight tree");
      if (controller.signal.aborted) return;
      if (payload.nodes.length <= 1) {
        setFreightTreeFeedback("No freights are linked to this freight");
        return;
      }
      setFreightTree(payload);
      closeInfoModal(() => {
        setInfoModalMode("about");
        setIsFreightTreeClosing(false);
        setFreightTreeZoom(0.75);
        setShowFreightTree(true);
      });
    } catch (error) {
      if (!controller.signal.aborted) {
        setFreightTreeError(true);
        setFreightTreeFeedback(error instanceof Error ? error.message : "Unable to load freight tree");
      }
    } finally {
      if (freightTreeRequestRef.current === controller) {
        freightTreeRequestRef.current = null;
        setIsLoadingFreightTree(false);
      }
    }
  }, [closeInfoModal, isLoadingFreightTree, selectedFreightOptionsId]);

  const closeFreightTree = useCallback(() => {
    if (!showFreightTree || isFreightTreeClosing) return;
    setIsFreightTreeClosing(true);
    freightTreeCloseTimerRef.current = setTimeout(() => {
      setShowFreightTree(false);
      setIsFreightTreeClosing(false);
      freightTreeCloseTimerRef.current = null;
    }, INFO_MODAL_ANIMATION_MS);
  }, [isFreightTreeClosing, showFreightTree]);

  useEffect(() => () => {
    if (freightTreeCloseTimerRef.current) clearTimeout(freightTreeCloseTimerRef.current);
  }, []);

  const createSignedFreightTreeAction = useCallback(async () => {
    if (!signer) {
      openWalletWithSeed();
      throw new Error("Connect a wallet first");
    }
    const address = await signer.getRecommendedAddress();
    if (!address) throw new Error("Unable to resolve wallet address");
    const nonceResponse = await fetch("/api/wallet/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, purpose: "freight-tree" }),
    });
    const noncePayload = await nonceResponse.json().catch(() => null) as { error?: string; nonce?: string } | null;
    if (!nonceResponse.ok || typeof noncePayload?.nonce !== "string") {
      throw new Error(noncePayload?.error ?? "Failed to create freight-tree nonce");
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

  const linkFreightFromFeed = useCallback(async (otherCampaignId: string, relation: FreightRelationChoice) => {
    if (!selectedFreightOptionsId) throw new Error("Current freight is unavailable");
    const signed = await createSignedFreightTreeAction();
    const response = await fetch("/api/freights/tree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...signed, campaignId: selectedFreightOptionsId, otherCampaignId, relation }),
    });
    const payload = await response.json() as FreightTree & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Unable to link freight");
    setFreightTree(payload);
    markCurrentProfileDataDirty();
  }, [createSignedFreightTreeAction, markCurrentProfileDataDirty, selectedFreightOptionsId]);

  const handleLinkExistingFreight = useCallback(async (otherCampaignId: string) => {
    if (!freightRelationChoice || freightLinkBusy) return;
    setFreightLinkBusy(true);
    setFreightLinkError("");
    try {
      await linkFreightFromFeed(otherCampaignId, freightRelationChoice);
      transitionFreightInfoModal("freight-link-success");
    } catch (error) {
      setFreightLinkError(error instanceof Error ? error.message : "Unable to link freight");
    } finally {
      setFreightLinkBusy(false);
    }
  }, [freightLinkBusy, freightRelationChoice, linkFreightFromFeed, transitionFreightInfoModal]);

  const handleLinkNewFreight = useCallback(async (campaignId: string) => {
    if (!freightRelationChoice) return;
    setPendingNewFreightId(campaignId);
    setFreightLinkError("");
    setInfoModalMode("freight-link-pending");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
    try {
      await linkFreightFromFeed(campaignId, freightRelationChoice);
      transitionFreightInfoModal("freight-link-success");
      setPendingNewFreightId(null);
    } catch (error) {
      setFreightLinkError(error instanceof Error ? error.message : "Unable to link the new freight");
      transitionFreightInfoModal("freight-link-error");
    }
  }, [freightRelationChoice, linkFreightFromFeed, setInfoModalInteraction, setIsInfoModalClosing, setShowInfoModal, transitionFreightInfoModal]);

  const openInsufficientFbarsInfoModal = useCallback((fromFreightRelationChoice = false) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer();
    if (fromFreightRelationChoice) {
      transitionFreightInfoModal("insufficient-fbars");
    } else {
      setInfoModalMode("insufficient-fbars");
      setInfoModalInteraction("click");
      setIsInfoModalClosing(false);
      setShowInfoModal(true);
    }
    submissionSuccessTimerRef.current = setTimeout(() => {
      closeInfoModal(resetHomeInfoModalState);
    }, 3000 + (fromFreightRelationChoice ? Math.max(120, INFO_MODAL_ANIMATION_MS - 500) : 0));
  }, [
    clearInfoCloseTimer,
    clearInfoHideTimer,
    clearSubmissionSuccessTimer,
    closeInfoModal,
    resetHomeInfoModalState,
    setInfoModalInteraction,
    setIsInfoModalClosing,
    setShowInfoModal,
    submissionSuccessTimerRef,
    transitionFreightInfoModal,
  ]);

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
    const handleEscapeClose = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (showInfoModal) {
        if (
          infoModalMode === "save-draft-confirm"
          || infoModalMode === "freight-link-pending"
          || freightLinkBusy
          || (infoModalMode === "ticket-purchase" && isPurchasingTickets)
          || (infoModalMode === "support-deposit" && isProcessingSupport)
          || (infoModalMode === "marquee-edit" && isSavingUserProfile)
        ) {
          return;
        }

        closeInfoModal(resetHomeInfoModalState);
        return;
      }

      if (showFreightTree) {
        closeFreightTree();
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
  }, [closeFreightTree, closeInfoModal, freightLinkBusy, infoModalMode, isProcessingSupport, isPurchasingTickets, isSavingUserProfile, requestCloseCreateModal, resetHomeInfoModalState, showCreateModal, showFreightTree, showInfoModal]);

  const shouldHideWalletAction = (showCreateModal && !isCreateModalClosing) || (showFreightTree && !isFreightTreeClosing);
  const isFreightOptionsFlow = infoModalMode === "freight-options" || infoModalMode === "freight-relation-choice" || infoModalMode === "freight-existing" || infoModalMode === "freight-link-pending" || infoModalMode === "freight-link-success" || infoModalMode === "freight-link-error";
  const infoModalBody = showFreightTree && infoModalMode === "about" ? (
    <FreightTreeHelpInfo />
  ) : infoModalMode === "marquee-edit" ? (
    <div className="create-info-constraints-copy">
      <div className="create-info-section-heading-row">
        <p className="create-review-section-label campaign-freight-options-heading font-bold">New Marquee Message:</p>
        {marqueeError || userProfileError ? <p className="create-review-section-label create-info-inline-status text-red-500" role="alert">{marqueeError || userProfileError}</p> : null}
      </div>
    </div>
  ) : infoModalMode === "freight-options" ? (
    <div className="create-info-constraints-copy campaign-freight-options-heading-row">
      <p className="create-review-section-label campaign-freight-options-heading">Freight Options:</p>
      {freightTreeFeedback ? (
        <p className={`create-review-section-label campaign-freight-options-feedback${freightTreeError ? " campaign-freight-options-feedback-error" : ""}`} role={freightTreeError ? "alert" : "status"}>
          {freightTreeFeedback}
        </p>
      ) : null}
    </div>
  ) : infoModalMode === "freight-relation-choice" ? (
    <div className="create-info-constraints-copy">
      <p className="create-review-section-label">{freightRelationChoice === "parent" ? "Add Parent:" : "Add Child:"}</p>
    </div>
  ) : infoModalMode === "freight-existing" ? (
    <div className="create-info-constraints-copy">
      <p className="create-review-section-label campaign-freight-options-heading">
        {freightRelationChoice === "parent" ? "Select Parent:" : "Select Child:"}
      </p>
      {!walletAddress ? <p className="create-info-constraint-item text-gray-500">Connect a wallet to select your freight.</p> : null}
      {ownedFreightsLoading ? <p className="create-info-constraint-item text-gray-500">Loading your freights...</p> : null}
      {freightLinkBusy ? <p className="create-info-constraint-item text-gray-500" role="status">Linking freight...</p> : null}
      {!ownedFreightsLoading && walletAddress && ownedFreights.length === 0 && !freightLinkError ? (
        <p className="create-info-constraint-item text-gray-500">No other published freights found.</p>
      ) : null}
      {ownedFreights.length > 0 ? (
        <div className="campaign-owned-freights" aria-label="Your published freights">
          {ownedFreights.map((freight) => (
            <button key={freight.campaignId} type="button" className="campaign-owned-freight" disabled={freightLinkBusy}
              onClick={() => void handleLinkExistingFreight(freight.campaignId)}>
              <span>{freight.title}</span>
              <small>{freight.campaignId}</small>
            </button>
          ))}
        </div>
      ) : null}
      {freightLinkError ? <p className="create-info-constraint-item text-red-500" role="alert">{freightLinkError}</p> : null}
    </div>
  ) : infoModalMode === "freight-link-pending" ? (
    <div className="create-info-constraints-copy">
      <p className="create-review-section-label campaign-freight-options-heading">Linking freight:</p>
      <p className="create-info-constraint-item text-gray-500"><LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> Linking your new freight...</p>
    </div>
  ) : infoModalMode === "freight-link-success" ? (
    <div className="create-info-constraints-copy">
      <p className="create-review-section-label campaign-freight-options-heading" style={{ color: "#16a34a" }}>Freight linked</p>
      <p className="create-info-constraint-item text-gray-500">{freightRelationChoice === "parent" ? "Parent" : "Child"} added successfully.</p>
    </div>
  ) : infoModalMode === "freight-link-error" ? (
    <div className="create-info-constraints-copy">
      <p className="create-review-section-label campaign-freight-options-heading text-red-500">Freight not linked</p>
      <p className="create-info-constraint-item text-red-500" role="alert">{freightLinkError}</p>
    </div>
  ) : infoModalMode === "freight-mountables" ? (
    <FreightMountablesInfo record={selectedFreightMountablesRecord} />
  ) : infoModalMode === "tag-suggestions" ? (
    <TagSuggestionsInfo initialQuery={tagSuggestionQuery} onContinue={handleTagSuggestionContinue} />
  ) : infoModalMode === "create-error" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 text-red-500 font-semibold">Errors:</p>
      <p className="create-info-constraint-item text-red-500 break-words"><span>{previewError}</span></p>
    </div>
  ) : infoModalMode === "submission-success" ? (
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
  ) : infoModalMode === "ticket-buy-success" || infoModalMode === "creator-withdraw-success" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label" style={{ color: "#16a34a" }}>
        {infoModalMode === "creator-withdraw-success" ? "Withdrawal successful" : "Buy Successful"}
      </p>
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
  ) : infoModalMode === "support-deposit-success" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label" style={{ color: "#16a34a" }}>
        {supportRequest?.supportMode === "direct_creator" ? "Tip successful" : "Deposit successful"}
      </p>
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
  ) : infoModalMode === "insufficient-fbars" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">Not enough FBARS</p>
      <p className="create-info-constraint-item text-gray-500 break-words">
        <span>{INSUFFICIENT_FBARS_MESSAGE}</span>
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
      <div className="create-info-section-heading-row mt-3">
        <p className="create-review-section-label text-gray-900">How many tickets?</p>
        {ticketPurchaseError ? (
          <p className={`create-review-section-label create-info-inline-status ${isPurchasingTickets ? "text-gray-500" : "text-red-500"}`} role={isPurchasingTickets ? "status" : "alert"}>
            {ticketPurchaseError}
          </p>
        ) : null}
      </div>
    </div>
  ) : infoModalMode === "support-deposit" ? (
    <div className="create-info-constraints-copy">
      <div className="create-info-section-heading-row">
        <p className="create-review-section-label text-gray-900">
          {supportRequest?.supportMode === "direct_creator" ? "Tip amount" : "Deposit amount"}
        </p>
        {supportError ? (
          <p className="create-review-section-label create-info-inline-status text-red-500" role="alert">{supportError}</p>
        ) : null}
      </div>
    </div>
  ) : infoModalMode === "raffle-settlement" ? (
    <RaffleSettlementInfo data={settlementModalData} isLoading={isLoadingSettlementModal} walletAddress={walletAddress} />
  ) : showCreateModal && infoModalMode === "mountables" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">Mountables:</p>
      <MountableOptionsCatalog
        childFreightMountableSelected={childFreightMountableSelected}
        formsMountableSelected={formsMountableSelected}
        lockMountableSelected={lockMountableSelected}
        registeredMountableApps={registeredMountableApps}
        selectedMountableAppIds={selectedMountableAppIds}
        onToggleForms={() => {
            const nextSelected = !formsMountableSelected;
            createModalContentRef.current?.setFormsMountableEnabled(nextSelected);
            setFormsMountableSelected(nextSelected);
            setMountableFormLinks((current) => current.length > 0 ? current : [""]);
            setMountablesPromptError("");
        }}
        onToggleChildFreight={() => {
          const enabled = !childFreightMountableSelected;
          createModalContentRef.current?.setChildFreightMountableEnabled(enabled);
          setChildFreightMountableSelected(enabled);
          setMountablesPromptError("");
        }}
        onToggleLock={() => {
            const nextSelected = !lockMountableSelected;
            createModalContentRef.current?.setLockMountableEnabled(nextSelected);
            setLockMountableSelected(nextSelected);
            setMountableLockFbars((current) => current || createModalContentRef.current?.getLockMountableConfig().minimumFbars || "");
            setMountablesPromptError("");
        }}
        onToggleApp={handleToggleMountableAppSelection}
      />
      {mountablesPromptError ? (
        <p className="create-info-constraint-item text-red-500 mt-3">
          <span>{mountablesPromptError}</span>
        </p>
      ) : null}
    </div>
  ) : showCreateModal && infoModalMode === "mountables-child-freight" ? (
    <ChildFreightMountableConfigurator
      title={mountableChildFreightTitle}
      onTitleChange={(title) => {
        setMountableChildFreightTitle(title);
        createModalContentRef.current?.updateChildFreightMountableConfig({ title });
      }}
    />
  ) : showCreateModal && infoModalMode === "mountables-lock" ? (
    <LockMountableConfigurator
      errorMessage={mountablesPromptError}
      fbars={mountableLockFbars}
      isFocused={isMountableLockFocused}
      onFbarsChange={(nextValue) => {
        setMountableLockFbars(nextValue);
        createModalContentRef.current?.updateLockMountableConfig({ minimumFbars: nextValue });
        setMountablesPromptError("");
      }}
      onFocusChange={setIsMountableLockFocused}
      onRuleChange={(rule) => {
        setMountableLockRule(rule);
        createModalContentRef.current?.updateLockMountableConfig({ rule });
      }}
      rule={mountableLockRule}
      validationState={mountableLockValidationState}
    />
  ) : showCreateModal && infoModalMode === "mountables-forms" ? (
    <FormsMountableConfigurator
      errorMessage={mountablesPromptError}
      formLinks={mountableFormLinks}
      isFocused={isMountableFormFocused}
      onFocusChange={setIsMountableFormFocused}
      onLinkChange={(index, nextValue) => {
        setMountableFormLinks((current) => current.map((entry, entryIndex) => entryIndex === index ? nextValue : entry));
        createModalContentRef.current?.updateFormsMountableConfig({ formUrl: nextValue });
        setMountableFormValidationState(nextValue.trim() ? "validating" : "idle");
        setMountablesPromptError("");
      }}
      validationState={mountableFormValidationState}
    />
  ) : showCreateModal && infoModalMode === "mountables-apps" ? (
    <MountableAppsConfigurator
      errorMessage={mountableAppsError || mountablesPromptError}
      mountedAppConfigs={mountedAppConfigs}
      onToggleSelectedMountablePrinciple={handleToggleSelectedMountablePrinciple}
      onUpdateSelectedMountablePrincipleParam={handleUpdateSelectedMountablePrincipleParam}
      registeredMountableApps={registeredMountableApps}
      selectedMountableAppId={selectedMountableAppId}
      selectedMountablePrincipleIds={selectedMountablePrincipleIds}
      selectedMountablePrincipleParams={selectedMountablePrincipleParams}
    />
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
          <CreateReviewMountablesInfo
            childFreightEnabled={childFreightMountableSelected}
            childFreightTitle={mountableChildFreightTitle}
            appMountables={mountedAppConfigs}
            formsEnabled={formsMountableSelected}
            formsUrl={mountableFormLinks[mountableFormLinks.length - 1] ?? ""}
            lockEnabled={lockMountableSelected}
            lockFbars={mountableLockFbars}
            lockRule={mountableLockRule}
          />
          {previewError && (
            <>
              <p className="mt-3 text-red-500 font-semibold">Errors</p>
              <p className="create-info-constraint-item text-red-500">
                <span>{previewError}</span>
              </p>
            </>
          )}
          {constraintStatus.isRaffle ? (
            <>
              <p className="mt-3 font-semibold">Support to pool:</p>
              <p className="create-info-constraint-item text-gray-500">
                <span>{CREATE_INFO_RAFFLE_SUPPORT_NOTE}</span>
              </p>
            </>
          ) : null}
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
  const handleIgnoreBuiltInMountable = async (kind: "forms" | "lock") => {
    try {
      setIsMountablesContinuing(true);
      setMountablesPromptError("");
      if (kind === "forms") {
        createModalContentRef.current?.setFormsMountableEnabled(false);
        setFormsMountableSelected(false);
      } else {
        createModalContentRef.current?.setLockMountableEnabled(false);
        setLockMountableSelected(false);
      }
      if (advanceMountableSetup(kind)) return;
      await createModalContentRef.current?.persistCurrentDraft();
      closeInfoModal(resetHomeInfoModalState);
      void createModalContentRef.current?.advanceToReviewAfterMountableSelection();
    } catch (error) {
      setMountablesPromptError(error instanceof Error ? error.message : `Failed to ignore mounted ${kind}`);
    } finally {
      setIsMountablesContinuing(false);
    }
  };

  const infoModalActions = infoModalMode === "marquee-edit" ? (
    <form className="create-info-confirm-actions marquee-info-modal-actions" onSubmit={(event) => {
      event.preventDefault();
      void handleSaveMarqueeMessage();
    }}>
      <input
        type="text"
        value={marqueeDraft}
        maxLength={120}
        onChange={(event) => {
          setMarqueeDraft(event.target.value);
          if (marqueeError) setMarqueeError("");
        }}
        className="create-info-ticket-input"
        aria-label="New marquee message"
        disabled={isSavingUserProfile}
        autoFocus
      />
      <button type="submit" className="create-info-confirm-btn create-info-confirm-btn-primary" disabled={isSavingUserProfile || !marqueeDraft.trim()}>
        {isSavingUserProfile ? "Saving..." : "Continue"}
      </button>
    </form>
  ) : infoModalMode === "freight-options" ? (
    <div className="create-info-confirm-actions campaign-freight-options-actions">
      {([ ["create-parent", "Add Parent"], ["create-child", "Add Child"], ["view-tree", "View Tree"] ] as const).map(([option, label]) => (
        <button key={option} type="button" data-option={option} className={`create-info-confirm-btn${option === "view-tree" ? " create-info-confirm-btn-primary" : ""}`}
          disabled={option === "view-tree" && isLoadingFreightTree}
          onClick={() => {
            if (option === "view-tree") {
              void handleViewFreightTree();
            } else {
              setFreightRelationChoice(option === "create-parent" ? "parent" : "child");
              transitionFreightInfoModal("freight-relation-choice");
            }
          }}>
          {label}
        </button>
      ))}
    </div>
  ) : infoModalMode === "freight-relation-choice" ? (
    <div className="create-info-confirm-actions campaign-freight-options-actions">
      <button type="button" className="create-info-confirm-btn" onClick={() => {
        setFreightRelationChoice(null);
        transitionFreightInfoModal("freight-options");
      }}>Back</button>
      <button type="button" className="create-info-confirm-btn" onClick={() => {
        setOwnedFreights([]);
        setFreightLinkError("");
        transitionFreightInfoModal("freight-existing");
      }}>Select Existing</button>
      <button type="button" className="create-info-confirm-btn" onClick={() => {
        if (!freightRelationChoice) return;
        if (typeof currentUserProfile?.fbars === "number" && currentUserProfile.fbars < FREIGHT_CREATION_FBARS_COST) {
          openInsufficientFbarsInfoModal(true);
          return;
        }
        setIsCreatingRelatedFreight(true);
        setShowInfoModal(false);
        setInfoModalMode("about");
        setInfoModalInteraction("hover");
        openCreateModal();
      }}>Create New</button>
    </div>
  ) : infoModalMode === "freight-existing" ? (
    <div className="create-info-confirm-actions">
      <button type="button" className="create-info-confirm-btn" disabled={freightLinkBusy}
        onClick={() => transitionFreightInfoModal("freight-relation-choice")}>Back</button>
    </div>
  ) : infoModalMode === "freight-link-success" ? (
    <div className="create-info-confirm-actions">
      <button type="button" className="create-info-confirm-btn create-info-confirm-btn-primary" onClick={() => closeInfoModal(resetHomeInfoModalState)}>Done</button>
    </div>
  ) : infoModalMode === "freight-link-error" && pendingNewFreightId ? (
    <div className="create-info-confirm-actions">
      <button type="button" className="create-info-confirm-btn create-info-confirm-btn-primary" onClick={() => void handleLinkNewFreight(pendingNewFreightId)}>Retry link</button>
    </div>
  ) : infoModalMode === "tag-suggestions" ? (
    <div className="create-info-confirm-actions">
      <button type="submit" form="tag-suggestions-form" className="create-info-confirm-btn create-info-confirm-btn-primary">
        Continue
      </button>
    </div>
  ) : infoModalMode === "support-deposit" ? (
    <form
      className="create-info-confirm-actions"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSupportSubmit();
      }}
    >
      <div className="create-info-ticket-input-wrap">
        <input
          type="number"
          min="0.01"
          step="0.01"
          inputMode="decimal"
          value={supportAmount}
          onChange={(event) => {
            setSupportAmount(event.target.value);
            if (supportError) setSupportError("");
          }}
          onFocus={(event) => {
            if (event.currentTarget.value.length > 0) event.currentTarget.select();
          }}
          className="create-info-ticket-input create-info-ticket-input-with-suffix"
          aria-label="Amount in CKB"
          placeholder="0.00"
          disabled={isProcessingSupport}
          autoFocus
        />
        <span className="create-info-ticket-input-suffix">CKB</span>
      </div>
      <button type="submit" className="create-info-confirm-btn create-info-confirm-btn-primary" disabled={isProcessingSupport}>
        {isProcessingSupport ? "Processing..." : "Continue"}
      </button>
    </form>
  ) : infoModalMode === "ticket-purchase" ? (
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
          beginMountableSetup();
        }}
      >
        Continue
      </button>
    </div>
  ) : showCreateModal && infoModalMode === "mountables-child-freight" ? (
    <div className="create-info-confirm-actions create-info-confirm-actions-tight">
      <button type="button" className="create-info-confirm-btn" disabled={isMountablesContinuing} onClick={() => goBackMountableSetup("child-freight")}>Back</button>
      <button type="button" className="create-info-confirm-btn create-info-confirm-btn-primary" disabled={isMountablesContinuing} onClick={() => {
        void (async () => {
          try {
            if (advanceMountableSetup("child-freight")) return;
            setIsMountablesContinuing(true);
            await createModalContentRef.current?.persistCurrentDraft();
            closeInfoModal(resetHomeInfoModalState);
            await createModalContentRef.current?.advanceToReviewAfterMountableSelection();
          } catch (error) {
            setMountablesPromptError(error instanceof Error ? error.message : "Failed to save child freight mountable");
          } finally {
            setIsMountablesContinuing(false);
          }
        })();
      }}>Continue</button>
    </div>
  ) : showCreateModal && infoModalMode === "mountables-lock" ? (
    <div className="create-info-mountable-app-actions">
      <div className="create-info-confirm-actions create-info-confirm-actions-tight">
        <button
          type="button"
          className="create-info-confirm-btn"
          onClick={() => goBackMountableSetup("lock")}
          disabled={isMountablesContinuing}
        >
          Back
        </button>
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

              if (advanceMountableSetup("lock")) {
                return;
              }

              setIsMountablesContinuing(true);
              setMountablesPromptError("");
              await createModalContentRef.current?.persistCurrentDraft();

              closeInfoModal(resetHomeInfoModalState);
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
      <button
        type="button"
        className="create-info-confirm-btn create-info-confirm-btn-ignore"
        disabled={isMountablesContinuing}
        onClick={() => void handleIgnoreBuiltInMountable("lock")}
      >
        Ignore
      </button>
    </div>
  ) : showCreateModal && infoModalMode === "mountables-forms" ? (
    <div className="create-info-mountable-app-actions">
      <div className="create-info-confirm-actions create-info-confirm-actions-tight">
        <button
          type="button"
          className="create-info-confirm-btn"
          onClick={() => goBackMountableSetup("forms")}
          disabled={isMountablesContinuing}
        >
          Back
        </button>
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

              if (advanceMountableSetup("forms")) {
                return;
              }

              await createModalContentRef.current?.persistCurrentDraft();

              closeInfoModal(resetHomeInfoModalState);
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
      <button
        type="button"
        className="create-info-confirm-btn create-info-confirm-btn-ignore"
        disabled={isMountablesContinuing}
        onClick={() => void handleIgnoreBuiltInMountable("forms")}
      >
        Ignore
      </button>
    </div>
  ) : showCreateModal && infoModalMode === "mountables-apps" ? (
    <div className="create-info-mountable-app-actions">
      <div className="create-info-confirm-actions">
        <button
          type="button"
          className="create-info-confirm-btn"
          onClick={() => goBackMountableSetup(`app:${selectedMountableAppId}`)}
          disabled={isMountablesContinuing || isVerifyingMountableApp}
        >
          Back
        </button>
        <button
          type="button"
          className="create-info-confirm-btn create-info-confirm-btn-primary"
          disabled={isMountablesContinuing || isVerifyingMountableApp || !selectedMountableAppId}
          onClick={() => {
            void (async () => {
              try {
                setIsMountablesContinuing(true);
                setMountablesPromptError("");
                await handleVerifySelectedMountableApp();

                if (advanceMountableSetup(`app:${selectedMountableAppId}`)) {
                  return;
                }

                await createModalContentRef.current?.persistCurrentDraft();
                closeInfoModal(resetHomeInfoModalState);
                void createModalContentRef.current?.advanceToReviewAfterMountableSelection();
              } catch (error) {
                setMountablesPromptError(error instanceof Error ? error.message : "Failed to set up mounted app");
              } finally {
                setIsMountablesContinuing(false);
              }
            })();
          }}
        >
          {isMountablesContinuing || isVerifyingMountableApp ? "Hold..." : "Continue"}
        </button>
      </div>
      <button
        type="button"
        className="create-info-confirm-btn create-info-confirm-btn-ignore"
        disabled={isMountablesContinuing || isVerifyingMountableApp || !selectedMountableAppId}
        onClick={() => {
          void (async () => {
            try {
              const ignoredAppId = selectedMountableAppId;
              handleToggleMountableAppSelection(ignoredAppId);

              if (advanceMountableSetup(`app:${ignoredAppId}`)) {
                return;
              }

              setIsMountablesContinuing(true);
              setMountablesPromptError("");
              await createModalContentRef.current?.persistCurrentDraft();
              closeInfoModal(resetHomeInfoModalState);
              void createModalContentRef.current?.advanceToReviewAfterMountableSelection();
            } catch (error) {
              setMountablesPromptError(error instanceof Error ? error.message : "Failed to ignore mounted app");
            } finally {
              setIsMountablesContinuing(false);
            }
          })();
        }}
      >
        Ignore
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
          className={`campaign-shell-header ${shellWidthClass} ${showCreateModal || showFreightTree ? "campaign-shell-header-transparent" : ""} fixed top-0 left-4 right-4 z-[70] mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`.trim()}
          infoButtonAriaLabel="Open Freight information"
          infoModalAriaLabel={infoModalMode === "marquee-edit" ? "New marquee message" : showFreightTree && infoModalMode === "about" ? "Linked freight information" : infoModalMode === "freight-relation-choice" ? freightRelationChoice === "parent" ? "Add Parent" : "Add Child" : infoModalMode === "freight-existing" ? "Select existing freight" : infoModalMode.startsWith("freight-link-") ? "Freight link status" : infoModalMode === "freight-options" ? "Freight options" : infoModalMode === "freight-mountables" ? "Freight mountables" : infoModalMode === "tag-suggestions" ? "Tag suggestions" : infoModalMode === "create-error" ? "Create freight errors" : infoModalMode === "submission-success" ? "Submission successful" : infoModalMode === "ticket-buy-success" ? "Buy successful" : infoModalMode === "creator-withdraw-success" ? "Withdrawal successful" : infoModalMode === "support-deposit" ? (supportRequest?.supportMode === "direct_creator" ? "Tip creator" : "Deposit CKB") : infoModalMode === "support-deposit-success" ? "Support transaction successful" : infoModalMode === "submission-error" ? "Transaction error" : infoModalMode === "insufficient-fbars" ? "Not enough FBARS" : infoModalMode === "ticket-purchase" ? "Buy raffle tickets" : infoModalMode === "raffle-settlement" ? "Raffle settlement details" : "Freight information modal"}
          infoModalBackdropAriaLabel={infoModalMode === "marquee-edit" ? "Close marquee editor" : infoModalMode === "save-draft-confirm" ? "Return to create freight modal" : infoModalMode === "ticket-purchase" ? "Close ticket purchase modal" : infoModalMode === "support-deposit" ? "Close support modal" : infoModalMode === "raffle-settlement" ? "Close raffle settlement modal" : "Close Freight information modal"}
          infoModalBackdropInteractive={((infoModalInteraction === "click" && infoModalMode !== "create-error") || infoModalMode === "save-draft-confirm" || infoModalMode === "submission-success" || infoModalMode === "ticket-purchase" || infoModalMode === "support-deposit" || infoModalMode === "raffle-settlement") && infoModalMode !== "freight-link-pending" && !freightLinkBusy && !(infoModalMode === "marquee-edit" && isSavingUserProfile)}
          infoModalBody={infoModalBody}
          infoModalActions={infoModalActions}
          infoModalClosing={isInfoModalClosing}
          infoModalOpen={showInfoModal}
          isConnected={Boolean(signer)}
          onConnect={openWalletWithSeed}
          onContainerClick={(event) => {
            if (event.target !== event.currentTarget) return;
            if (showInfoModal) {
              if (infoModalMode !== "create-error" && infoModalMode !== "freight-link-pending" && !freightLinkBusy && !(infoModalMode === "ticket-purchase" && isPurchasingTickets) && !(infoModalMode === "support-deposit" && isProcessingSupport) && !(infoModalMode === "marquee-edit" && isSavingUserProfile)) {
                closeInfoModal(resetHomeInfoModalState);
              }
            } else if (showFreightTree) {
              closeFreightTree();
            } else if (showCreateModal) {
              requestCloseCreateModal();
            }
          }}
          onCopyWalletAddress={() => void handleCopyWalletAddress()}
          onDisconnect={disconnect}
          onInfoButtonBlur={() => scheduleCloseInfoModal(isFreightOptionsFlow || infoModalMode === "marquee-edit" || infoModalMode === "freight-mountables" || infoModalMode === "tag-suggestions" || infoModalMode === "create-error" || infoModalMode === "save-draft-confirm" || infoModalMode === "mountables" || infoModalMode === "mountables-child-freight" || infoModalMode === "mountables-lock" || infoModalMode === "mountables-forms" || infoModalMode === "mountables-apps" || infoModalMode === "insufficient-fbars" || (infoModalMode === "ticket-purchase" && isPurchasingTickets) || (infoModalMode === "support-deposit" && isProcessingSupport), resetHomeInfoModalState)}
          onInfoButtonClick={() => router.push("/")}
          onInfoButtonFocus={() => openInfoModalFromHover(isFreightOptionsFlow || infoModalMode === "freight-mountables" || infoModalMode === "tag-suggestions" || infoModalMode === "save-draft-confirm" || infoModalMode === "mountables" || infoModalMode === "mountables-child-freight" || infoModalMode === "mountables-lock" || infoModalMode === "mountables-forms" || infoModalMode === "mountables-apps")}
          onInfoModalKeepOpen={keepInfoModalOpen}
          onInfoModalRequestClose={() => {
            if (infoModalMode !== "create-error" && infoModalMode !== "freight-link-pending" && !freightLinkBusy && !(infoModalMode === "ticket-purchase" && isPurchasingTickets) && !(infoModalMode === "support-deposit" && isProcessingSupport) && !(infoModalMode === "marquee-edit" && isSavingUserProfile)) closeInfoModal(resetHomeInfoModalState);
          }}
          onInfoModalScheduleClose={() => scheduleCloseInfoModal(isFreightOptionsFlow || infoModalMode === "marquee-edit" || infoModalMode === "freight-mountables" || infoModalMode === "tag-suggestions" || infoModalMode === "create-error" || infoModalMode === "save-draft-confirm" || infoModalMode === "mountables" || infoModalMode === "mountables-child-freight" || infoModalMode === "mountables-lock" || infoModalMode === "mountables-forms" || infoModalMode === "mountables-apps" || infoModalMode === "insufficient-fbars" || (infoModalMode === "ticket-purchase" && isPurchasingTickets) || (infoModalMode === "support-deposit" && isProcessingSupport), resetHomeInfoModalState)}
          onInfoMouseEnter={() => openInfoModalFromHover(isFreightOptionsFlow || infoModalMode === "freight-mountables" || infoModalMode === "tag-suggestions" || infoModalMode === "save-draft-confirm" || infoModalMode === "mountables" || infoModalMode === "mountables-child-freight" || infoModalMode === "mountables-lock" || infoModalMode === "mountables-forms" || infoModalMode === "mountables-apps")}
          onInfoMouseLeave={() => scheduleCloseInfoModal(isFreightOptionsFlow || infoModalMode === "marquee-edit" || infoModalMode === "freight-mountables" || infoModalMode === "tag-suggestions" || infoModalMode === "create-error" || infoModalMode === "save-draft-confirm" || infoModalMode === "mountables" || infoModalMode === "mountables-child-freight" || infoModalMode === "mountables-lock" || infoModalMode === "mountables-forms" || infoModalMode === "mountables-apps" || infoModalMode === "insufficient-fbars" || (infoModalMode === "ticket-purchase" && isPurchasingTickets) || (infoModalMode === "support-deposit" && isProcessingSupport), resetHomeInfoModalState)}
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
          ) : showFreightTree ? (
            <FreightTreeZoomActions isClosing={isFreightTreeClosing} zoom={freightTreeZoom} setZoom={setFreightTreeZoom} />
          ) : undefined}
          canEditLightModePrimaryColor={canEditLightModePrimaryColor}
          currentLightModePrimaryColor={currentUserProfile?.lightModePrimaryColor ?? null}
          shouldHideWalletAction={shouldHideWalletAction}
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

        {signer && (
          <div className="retro-mountables-panel retro-mountables-panel-bordered p-3 rounded-lg">
            <MountablesPanel onEditMarquee={handleOpenMarqueeEditor} />
          </div>
        )}

        <CampaignFeedSection
          client={client}
          currentViewerFbars={currentUserProfile?.fbars}
          onCommentDiscardRequest={handleCommentDiscardRequest}
          commentDiscardDecision={commentDiscardDecision}
          onTicketPurchaseRequest={handleOpenTicketPurchaseInfoModal}
          onSupportRequest={handleOpenSupportInfoModal}
          onWithdrawalSuccess={(txHash) => openTransactionSuccessInfoModal(txHash, "creator-withdraw-success")}
          onErrorChange={handleFreightsLoadError}
          onMountablesClick={handleFreightMountablesClick}
          onFreightOptionsClick={handleFreightOptionsClick}
          onProfileDataChanged={markCurrentProfileDataDirty}
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
        onInsufficientFbars={openInsufficientFbarsInfoModal}
        onMountableSelectionRequired={openMountablesModal}
        onTagSuggestionsRequested={handleTagSuggestionsRequested}
        onMountableSelectionStateChange={handleMountableSelectionStateChange}
        onOpenCreateModal={() => {
          setIsCreatingRelatedFreight(false);
          setFreightRelationChoice(null);
          setSelectedFreightOptionsId(null);
          openCreateModal();
        }}
        onPreviewErrorChange={handleCreateErrorChange}
        onPublishSuccess={(txHash, _randomnessPreimage, campaignId) => {
          finalizeCloseCreateModal();
          markCurrentProfileDataDirty();
          if (isCreatingRelatedFreight && freightRelationChoice && selectedFreightOptionsId) void handleLinkNewFreight(campaignId);
          else openSubmissionSuccessInfoModal(txHash);
        }}
        onRequestCloseCreateModal={requestCloseCreateModal}
        onStepChange={setCreateModalStep}
        showCreateModal={showCreateModal}
        isCreateModalClosing={isCreateModalClosing}
        availableFbars={currentUserProfile?.fbars}
      />
      {showFreightTree && freightTree ? (
        <>
          <button type="button" className={`create-campaign-backdrop ${isFreightTreeClosing ? "create-campaign-backdrop-closing" : ""}`} aria-label="Close freight tree modal" onClick={closeFreightTree} />
          <div className={`create-campaign-modal campaign-freight-tree-modal campaign-freight-tree-modal-diagram ${isFreightTreeClosing ? "create-campaign-modal-closing" : ""}`} role="dialog" aria-modal="true" aria-label="Freight tree">
            <FreightTreeDiagram tree={freightTree} zoom={freightTreeZoom} />
          </div>
        </>
      ) : null}
    </main>
  );
}
