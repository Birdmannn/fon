"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bookmark,
  Check,
  CheckCircle,
  Coins,
  Copy,
  Heart,
  MessageSquare,
  Plus,
  RefreshCw,
  Repeat2,
  RotateCcw,
  Search,
  Share2,
  Ticket,
} from "lucide-react";
import { ccc } from "@ckb-ccc/connector-react";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import CreateCampaignModalContent, {
  CreateCampaignModalContentHandle,
  CreateConstraintStatus,
  CreateModalStep,
} from "@/app/create/_components/CreateCampaignModalContent";
import FreightInfoModal from "@/app/_components/FreightInfoModal";
import { CampaignStatus } from "@/lib/contract";
import { fetchCampaigns, fetchParticipants, previewDeterministicWinners, sendBatchDeliver, sendDeposit, sendUpdateCampaignStatus, sendVerifyParticipantRaffle, CampaignCell, ParticipantCell } from "@/lib/transactions";
import { bytesToHex, decodeSummary, hexToBytes } from "@/lib/encoding";

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

const STATUS_LABELS = ["Created", "Active", "Completed", "Cancelled"];
const TYPE_LABELS = ["Simple Task", "Funded Task", "Crowdfunding", "Timed Challenge", "Raffle"];
const TYPE_TAGS = ["SimpleTask", "FundedTask", "Crowdfunding", "TimedChallenge", "Raffle"];
const MOUNTABLES_PLACEHOLDER_MESSAGE = "NO MOUNTABLES YET. RAFFLE RAFFLE RAFFLE.   ";
const CAMPAIGN_CARD_PREVIEW_MAX_CHARS = 280;

type CampaignComment = {
  text: string;
  creatorAddress?: string | null;
  creatorHandle?: string | null;
  createdAt?: string;
};

type CampaignRecord = {
  _id?: string;
  title?: string;
  description?: string;
  campaignType?: number;
  summaryDraft?: string;
  argsDraft?: {
    taskStartDelayHours?: string;
    taskDurationHours?: string;
    maxAmountCkb?: string;
    auxAmountCkb?: string;
  };
  socialMetadata?: {
    mentions?: string[];
    comments?: unknown[];
    likeCount?: number;
    likedByAddresses?: string[];
    bookmarkCount?: number;
    reshareCount?: number;
  };
  creatorAddress?: string | null;
  creatorHandle?: string | null;
  status?: "draft" | "published" | "publish_failed";
  txHash?: string | null;
  publishError?: string | null;
  randomnessPreimage?: string | null;
};

type MergedCampaign = {
  campaign: CampaignCell;
  record: CampaignRecord | null;
  displayStatus: CampaignStatus;
};

type InfoModalMode = "about" | "save-draft-confirm" | "submission-success" | "submission-error" | "discard-comment-confirm" | "ticket-purchase" | "raffle-settlement";
type CampaignCountdownTone = "good" | "warn" | "danger" | "ended";
type CampaignCountdownPhase = "start" | "duration" | "ended";
type SettlementModalData = {
  campaignTitle: string;
  randomnessHash: string;
  randomnessPreimage: string | null;
  evidenceItems: string[];
  recipients: string[];
  distributionTxHash: string | null;
};

function normalizeHash(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

function deriveDisplayStatus(campaign: CampaignCell, nowMs: number = Date.now()) {
  if (campaign.data.status === CampaignStatus.Cancelled || campaign.data.status === CampaignStatus.Completed) {
    return campaign.data.status;
  }

  const createdAtSeconds = Number(campaign.data.createdAt) / 1000;
  const nowSeconds = nowMs / 1000;
  const startsAtSeconds = createdAtSeconds + Number(campaign.data.startDurationSecs);
  const endsAtSeconds = startsAtSeconds + Number(campaign.data.taskDurationSecs);

  if (nowSeconds < startsAtSeconds) {
    return CampaignStatus.Created;
  }

  if (nowSeconds >= endsAtSeconds) {
    return CampaignStatus.Completed;
  }

  return CampaignStatus.Active;
}

function getStatusClassName(status: CampaignStatus) {
  switch (status) {
    case CampaignStatus.Active:
      return "active";
    case CampaignStatus.Completed:
      return "completed";
    case CampaignStatus.Cancelled:
      return "cancelled";
    case CampaignStatus.Created:
    default:
      return "created";
  }
}

function formatCkbAmount(value: bigint) {
  return (Number(value) / 1e8).toFixed(2);
}

function formatCountdownSegment(value: number) {
  return String(Math.max(0, value)).padStart(2, "0");
}

function buildCampaignCountdown(campaign: CampaignCell, nowMs: number) {
  const createdAtMs = Number(campaign.data.createdAt);
  const startDelayMs = Math.max(0, Number(campaign.data.startDurationSecs) * 1000);
  const durationMs = Math.max(0, Number(campaign.data.taskDurationSecs) * 1000);
  const startsAtMs = createdAtMs + startDelayMs;
  const endsAtMs = startsAtMs + durationMs;

  let remainingMs = 0;
  let initialMs = 0;
  let phase: CampaignCountdownPhase = "ended";

  if (nowMs < startsAtMs) {
    phase = "start";
    remainingMs = startsAtMs - nowMs;
    initialMs = startDelayMs;
  } else if (nowMs < endsAtMs) {
    phase = "duration";
    remainingMs = endsAtMs - nowMs;
    initialMs = durationMs;
  }

  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (phase === "ended" || totalSeconds === 0) {
    return {
      text: "--",
      tone: "ended" as CampaignCountdownTone,
      phase: "ended" as CampaignCountdownPhase,
    };
  }

  const ratio = initialMs > 0 ? remainingMs / initialMs : 0;
  const tone: CampaignCountdownTone = ratio <= 0.2 ? "danger" : ratio <= 0.5 ? "warn" : "good";
  const segments = [
    days > 0 ? `${formatCountdownSegment(days)}D` : null,
    days > 0 || hours > 0 ? `${formatCountdownSegment(hours)}H` : null,
    days > 0 || hours > 0 || minutes > 0 ? `${formatCountdownSegment(minutes)}M` : null,
    `${formatCountdownSegment(seconds)}S`,
  ].filter(Boolean) as string[];

  return {
    text: segments.join(" "),
    tone,
    phase,
  };
}

function truncateCampaignDescription(text: string, maxChars: number) {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  const slice = text.slice(0, maxChars);
  const cutIndex = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
  const trimmed = (cutIndex > maxChars * 0.55 ? slice.slice(0, cutIndex) : slice).trimEnd();

  return {
    text: `${trimmed}…`,
    truncated: true,
  };
}

function truncateAddress(address: string) {
  if (address.length <= 16) {
    return address;
  }

  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function buildDefaultHandle(addressHex: string) {
  const normalized = addressHex.toLowerCase().replace(/^0x/, "");
  return `freight${normalized.slice(-20)}.ckb`;
}

function decodeCreatedByAddress(campaign: CampaignCell) {
  return bytesToHex(campaign.data.createdBy);
}

function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return Promise.reject(new Error("Clipboard API unavailable"));
}

function getCampaignIdentity(campaign: CampaignCell) {
  return `${campaign.outPoint.txHash}:${campaign.outPoint.index}`;
}

function formatCompactCampaignCount(count: number) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 0,
  }).format(count).toLowerCase();
}

function deriveChainLabel(client: ccc.Client) {
  if (client instanceof ccc.ClientPublicMainnet) {
    return "Mainnet";
  }

  if (client instanceof ccc.ClientPublicTestnet) {
    return "Testnet";
  }

  return "Custom";
}

export default function Home() {
  const { open, disconnect, client } = ccc.useCcc();
  const signer = ccc.useSigner();
  const INFO_MODAL_ANIMATION_MS = 620;
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [isInfoModalClosing, setIsInfoModalClosing] = useState(false);
  const [infoModalInteraction, setInfoModalInteraction] = useState<"hover" | "click">("hover");
  const [infoModalMode, setInfoModalMode] = useState<InfoModalMode>("about");
  const [saveDraftPromptError, setSaveDraftPromptError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreateModalClosing, setIsCreateModalClosing] = useState(false);
  const [showStickyHeader, setShowStickyHeader] = useState(true);
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
  const [submissionErrorMessage, setSubmissionErrorMessage] = useState("");
  const [settlementModalData, setSettlementModalData] = useState<SettlementModalData | null>(null);
  const handleFreightsLoadError = useCallback((message: string) => {
    setSubmissionErrorMessage(message);
  }, []);
  const [ticketPurchaseCampaign, setTicketPurchaseCampaign] = useState<CampaignCell | null>(null);
  const [ticketPurchaseQuantity, setTicketPurchaseQuantity] = useState("1");
  const [ticketPurchaseError, setTicketPurchaseError] = useState("");
  const [isPurchasingTickets, setIsPurchasingTickets] = useState(false);
  const [showWalletInfoModal, setShowWalletInfoModal] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [walletInfoError, setWalletInfoError] = useState("");
  const [walletInfoLoading, setWalletInfoLoading] = useState(false);
  const [walletCopyFeedback, setWalletCopyFeedback] = useState<"idle" | "copied" | "error">("idle");
  const infoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submissionSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerInfoButtonRef = useRef<HTMLButtonElement>(null);
  const createModalContentRef = useRef<CreateCampaignModalContentHandle>(null);

  const clearInfoCloseTimer = () => {
    if (infoCloseTimerRef.current) {
      clearTimeout(infoCloseTimerRef.current);
      infoCloseTimerRef.current = null;
    }
  };

  const clearInfoHideTimer = () => {
    if (infoHideTimerRef.current) {
      clearTimeout(infoHideTimerRef.current);
      infoHideTimerRef.current = null;
    }
  };

  const clearCreateHideTimer = () => {
    if (createHideTimerRef.current) {
      clearTimeout(createHideTimerRef.current);
      createHideTimerRef.current = null;
    }
  };

  const clearSubmissionSuccessTimer = () => {
    if (submissionSuccessTimerRef.current) {
      clearTimeout(submissionSuccessTimerRef.current);
      submissionSuccessTimerRef.current = null;
    }
  };

  const resetTicketPurchaseState = useCallback(() => {
    setTicketPurchaseCampaign(null);
    setTicketPurchaseQuantity("1");
    setTicketPurchaseError("");
    setIsPurchasingTickets(false);
  }, []);
  const walletChainLabel = useMemo(() => deriveChainLabel(client), [client]);

  const showInfoModalForInteraction = useCallback((interaction: "hover" | "click") => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    resetTicketPurchaseState();
    setInfoModalMode("about");
    setSaveDraftPromptError("");
    setInfoModalInteraction(interaction);
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [resetTicketPurchaseState]);

  const openSaveDraftConfirmModal = useCallback(() => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    setInfoModalMode("save-draft-confirm");
    setSaveDraftPromptError("");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, []);

  const handleCopyWalletAddress = useCallback(async () => {
    if (!walletAddress) {
      return;
    }

    try {
      await copyText(walletAddress);
      setWalletCopyFeedback("copied");
      window.setTimeout(() => setWalletCopyFeedback("idle"), 1200);
    } catch {
      setWalletCopyFeedback("error");
      window.setTimeout(() => setWalletCopyFeedback("idle"), 1200);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!signer) {
      setShowWalletInfoModal(false);
      setWalletAddress("");
      setWalletBalance(null);
      setWalletInfoError("");
      setWalletInfoLoading(false);
      return;
    }

    if (!showWalletInfoModal) {
      return;
    }

    let cancelled = false;

    setWalletInfoLoading(true);
    setWalletInfoError("");

    void (async () => {
      try {
        const [nextAddress, nextBalance] = await Promise.all([
          signer.getRecommendedAddress(),
          signer.getBalance(),
        ]);

        if (cancelled) {
          return;
        }

        setWalletAddress(nextAddress ?? "");
        setWalletBalance(nextBalance);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setWalletInfoError(error instanceof Error ? error.message : "Unable to load wallet details");
      } finally {
        if (!cancelled) {
          setWalletInfoLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showWalletInfoModal, signer]);

  const openInfoModalFromHover = () => {
    clearInfoCloseTimer();
    clearInfoHideTimer();

    if (infoModalMode === "save-draft-confirm") {
      return;
    }

    if (showInfoModal && infoModalInteraction === "click" && !isInfoModalClosing) {
      return;
    }

    showInfoModalForInteraction("hover");
  };

  const keepInfoModalOpen = () => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer();
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  };

  const closeInfoModal = useCallback(() => {
    clearInfoCloseTimer();
    clearSubmissionSuccessTimer();

    if (!showInfoModal || isInfoModalClosing) return;

    setIsInfoModalClosing(true);
    clearInfoHideTimer();
    infoHideTimerRef.current = setTimeout(() => {
      setShowInfoModal(false);
      setIsInfoModalClosing(false);
      setInfoModalInteraction("hover");
      setInfoModalMode("about");
      setSaveDraftPromptError("");
      setSubmissionSuccessTxHash("");
      setSubmissionErrorMessage("");
      setSettlementModalData(null);
      resetTicketPurchaseState();
      infoHideTimerRef.current = null;
    }, INFO_MODAL_ANIMATION_MS);
  }, [showInfoModal, isInfoModalClosing, resetTicketPurchaseState]);

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
  }, [showCreateModal, isCreateModalClosing]);

  const closeInfoAndCreateModal = useCallback(() => {
    clearInfoCloseTimer();
    clearSubmissionSuccessTimer();
    clearInfoHideTimer();
    clearCreateHideTimer();

    if (showInfoModal && !isInfoModalClosing) {
      setIsInfoModalClosing(true);
      infoHideTimerRef.current = setTimeout(() => {
        setShowInfoModal(false);
        setIsInfoModalClosing(false);
        setInfoModalInteraction("hover");
        setInfoModalMode("about");
        setSaveDraftPromptError("");
        setSubmissionSuccessTxHash("");
        infoHideTimerRef.current = null;
      }, INFO_MODAL_ANIMATION_MS);
    }

    if (showCreateModal && !isCreateModalClosing) {
      setIsCreateModalClosing(true);
      createHideTimerRef.current = setTimeout(() => {
        setShowCreateModal(false);
        setIsCreateModalClosing(false);
        setCreateModalStep("compose");
        setPreviewError("");
        setSaveDraftPromptError("");
        setIsCreateDraftListOpen(false);
        createHideTimerRef.current = null;
      }, INFO_MODAL_ANIMATION_MS);
    }
  }, [isCreateModalClosing, isInfoModalClosing, showCreateModal, showInfoModal]);

  const openSubmissionSuccessInfoModal = useCallback((txHash: string) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer();
    setSubmissionErrorMessage("");
    setSubmissionSuccessTxHash(txHash);
    setInfoModalMode("submission-success");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
    submissionSuccessTimerRef.current = setTimeout(() => {
      closeInfoModal();
    }, 2500);
  }, [closeInfoModal]);

  const openSubmissionErrorInfoModal = useCallback((message: string) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer();
    setSubmissionSuccessTxHash("");
    setSubmissionErrorMessage(message);
    setInfoModalMode("submission-error");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, []);

  const openTicketPurchaseInfoModal = useCallback((campaign: CampaignCell) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearSubmissionSuccessTimer();
    setTicketPurchaseCampaign(campaign);
    setTicketPurchaseQuantity("1");
    setTicketPurchaseError("");
    setIsPurchasingTickets(false);
    setInfoModalMode("ticket-purchase");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, []);

  const handleTicketPurchaseSubmit = useCallback(async () => {
    if (!signer || !ticketPurchaseCampaign) {
      return;
    }

    const quantity = Number.parseInt(ticketPurchaseQuantity.trim(), 10);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setTicketPurchaseError("Enter a valid number of tickets");
      return;
    }

    const requestedTickets = BigInt(quantity);
    if (requestedTickets !== 1n) {
      setTicketPurchaseError("One ticket at a time for now");
      return;
    }

    const totalCostShannons = ticketPurchaseCampaign.data.auxAmount;
    if (totalCostShannons <= 0n) {
      setTicketPurchaseError("Ticket price is unavailable for this raffle");
      return;
    }

    const remainingCapacity = ticketPurchaseCampaign.data.maximumAmount > ticketPurchaseCampaign.data.currentDeposits
      ? ticketPurchaseCampaign.data.maximumAmount - ticketPurchaseCampaign.data.currentDeposits
      : 0n;
    const remainingTickets = ticketPurchaseCampaign.data.auxAmount > 0n
      ? remainingCapacity / ticketPurchaseCampaign.data.auxAmount
      : 0n;
    if (remainingTickets <= 0n || totalCostShannons > remainingCapacity) {
      setTicketPurchaseError(`Only ${String(remainingTickets)} tickets remain`);
      return;
    }

    setIsPurchasingTickets(true);
    setTicketPurchaseError("");

    try {
      const txHash = await sendVerifyParticipantRaffle(signer, ticketPurchaseCampaign);
      openSubmissionSuccessInfoModal(txHash);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to buy tickets";
      setTicketPurchaseError(message);
      setIsPurchasingTickets(false);
      openSubmissionErrorInfoModal(message);
    }
  }, [openSubmissionErrorInfoModal, openSubmissionSuccessInfoModal, signer, ticketPurchaseCampaign, ticketPurchaseQuantity]);

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
  }, []);

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

  const scheduleCloseInfoModal = () => {
    if (infoModalMode === "save-draft-confirm") {
      return;
    }

    if (infoModalMode === "submission-success") {
      clearSubmissionSuccessTimer();
      submissionSuccessTimerRef.current = setTimeout(() => {
        closeInfoModal();
      }, 120);
      return;
    }

    clearInfoCloseTimer();
    infoCloseTimerRef.current = setTimeout(() => {
      closeInfoModal();
    }, 120);
  };

  const toggleInfoModal = () => {
    if (infoModalMode === "save-draft-confirm") {
      return;
    }

    if (showInfoModal && !isInfoModalClosing) {
      closeInfoModal();
      return;
    }

    showInfoModalForInteraction("click");
  };

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
  }, []);

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
      <p className="mt-3 create-review-section-label text-green-600">Submission successful</p>
      <p className="create-info-constraint-item text-gray-500 font-mono break-all">
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
        <p className="create-info-constraint-item text-red-500">
          <span>{ticketPurchaseError}</span>
        </p>
      ) : null}
    </div>
  ) : infoModalMode === "raffle-settlement" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">{settlementModalData?.campaignTitle ?? "Raffle settlement"}</p>
      <p className="mt-3 text-gray-900 font-semibold">Random hash:</p>
      <p className="create-info-constraint-item text-gray-500 font-mono break-all">
        <span>{settlementModalData?.randomnessHash ?? "Unavailable"}</span>
      </p>
      <p className="mt-3 text-gray-900 font-semibold">Evidence:</p>
      {(settlementModalData?.evidenceItems ?? []).map((item) => (
        <p key={item} className="create-info-constraint-item">
          <span>{item}</span>
        </p>
      ))}
      <p className="mt-3 text-gray-900 font-semibold">Recipients:</p>
      {(settlementModalData?.recipients ?? []).length > 0 ? (
        (settlementModalData?.recipients ?? []).map((recipient) => (
          <p key={recipient} className="create-info-constraint-item text-gray-500 font-mono break-all">
            <span>{recipient}</span>
          </p>
        ))
      ) : (
        <p className="create-info-constraint-item text-gray-500">
          <span>No recipients found.</span>
        </p>
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
      <div className="w-full max-w-2xl flex flex-col gap-6 pt-16">
        <div
          className="fixed top-8 left-4 right-4 z-[70] mx-auto w-full max-w-2xl flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
          onClick={showCreateModal ? (event) => {
            if (event.target === event.currentTarget) {
              requestCloseCreateModal();
            }
          } : undefined}
        >
          <div className="header-info-wrap" onClick={(event) => event.stopPropagation()}>
            <div onMouseEnter={openInfoModalFromHover} onMouseLeave={scheduleCloseInfoModal}>
              <button
                ref={headerInfoButtonRef}
                type="button"
                className="header-info-btn"
                aria-label="Open Freight information"
                onClick={toggleInfoModal}
                onFocus={openInfoModalFromHover}
                onBlur={scheduleCloseInfoModal}
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
                  onMouseEnter={() => setShowWalletInfoModal(true)}
                  onMouseLeave={() => setShowWalletInfoModal(false)}
                >
                  <button
                    onClick={disconnect}
                    className="px-4 py-2 rounded-full overflow-hidden font-semibold text-sm btn-wallet w-full sm:w-auto"
                  >
                    Disconnect
                  </button>
                  {showWalletInfoModal && (
                    <div className="wallet-info-modal" role="dialog" aria-label="Wallet details">
                      <p className="wallet-info-heading">Wallet details</p>
                      <div className="wallet-info-section">
                        <span className="wallet-info-label">Address</span>
                        <div className="wallet-info-address-row">
                          <span className="wallet-info-address">{walletAddress || "Loading…"}</span>
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
                          <span className="wallet-info-value">
                            {walletInfoLoading ? "Loading…" : walletBalance !== null ? `${formatCkbAmount(walletBalance)} CKB` : "--"}
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
            ariaLabel={infoModalMode === "submission-success" ? "Submission successful" : infoModalMode === "submission-error" ? "Transaction error" : infoModalMode === "ticket-purchase" ? "Buy raffle tickets" : infoModalMode === "raffle-settlement" ? "Raffle settlement details" : "Freight information modal"}
            body={infoModalBody}
            actions={infoModalActions}
            backdropAriaLabel={infoModalMode === "save-draft-confirm" ? "Return to create freight modal" : infoModalMode === "ticket-purchase" ? "Close ticket purchase modal" : infoModalMode === "raffle-settlement" ? "Close raffle settlement modal" : "Close Freight information modal"}
            backdropInteractive={infoModalInteraction === "click" || infoModalMode === "save-draft-confirm" || infoModalMode === "submission-success" || infoModalMode === "ticket-purchase" || infoModalMode === "raffle-settlement"}
            onRequestClose={closeInfoModal}
            onKeepOpen={keepInfoModalOpen}
            onScheduleClose={scheduleCloseInfoModal}
          />
        </div>

        {signer && (
          <div className="retro-mountables-panel p-3 rounded-lg border border-gray-200">
            <MountablesPanel />
          </div>
        )}

        <CampaignListHeader
          client={client}
          onCommentDiscardRequest={handleCommentDiscardRequest}
          commentDiscardDecision={commentDiscardDecision}
          onTicketPurchaseRequest={openTicketPurchaseInfoModal}
          onErrorChange={handleFreightsLoadError}
          onSettlementInfoRequest={(data) => {
            setSettlementModalData(data);
            setInfoModalMode("raffle-settlement");
            setInfoModalInteraction("click");
            setIsInfoModalClosing(false);
            setShowInfoModal(true);
          }}
          onSubmissionErrorRequest={openSubmissionErrorInfoModal}
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
            onPublishSuccess={(txHash) => {
              finalizeCloseCreateModal();
              openSubmissionSuccessInfoModal(txHash);
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

function MountablesPanel() {
  const marqueeText = `${MOUNTABLES_PLACEHOLDER_MESSAGE}${MOUNTABLES_PLACEHOLDER_MESSAGE}${MOUNTABLES_PLACEHOLDER_MESSAGE}`;

  return (
    <div className="retro-mountables-shell" aria-label="Mountables display">
      {/* <div className="retro-marquee-viewport"> */}
        <div className="retro-marquee-track">
          <span>{marqueeText}</span>
          <span aria-hidden="true">{marqueeText}</span>
        </div>
      {/* </div> */}
    </div>
  );
}

function CampaignListHeader({ client, onCommentDiscardRequest, commentDiscardDecision, onTicketPurchaseRequest, onErrorChange, onSettlementInfoRequest, onSubmissionErrorRequest }: { client: ccc.Client; onCommentDiscardRequest: (cardId: string) => void; commentDiscardDecision: { cardId: string; discard: boolean } | null; onTicketPurchaseRequest: (campaign: CampaignCell) => void; onErrorChange: (message: string) => void; onSettlementInfoRequest: (data: SettlementModalData) => void; onSubmissionErrorRequest: (message: string) => void; }) {
  const [campaigns, setCampaigns] = useState<CampaignCell[]>([]);
  const [recordsByTxHash, setRecordsByTxHash] = useState<Record<string, CampaignRecord>>({});
  const [pendingCampaigns, setPendingCampaigns] = useState<CampaignCell[] | null>(null);
  const [pendingRecordsByTxHash, setPendingRecordsByTxHash] = useState<Record<string, CampaignRecord> | null>(null);
  const [unseenCampaignCount, setUnseenCampaignCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [shouldScrollToNewest, setShouldScrollToNewest] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const campaignsRef = useRef<CampaignCell[]>(campaigns);

  const buildRecordsByTxHash = useCallback((records: CampaignRecord[]) => {
    const nextRecordsByTxHash: Record<string, CampaignRecord> = {};

    for (const record of records) {
      const key = normalizeHash(record.txHash);
      if (key && !nextRecordsByTxHash[key]) {
        nextRecordsByTxHash[key] = record;
      }
    }

    return nextRecordsByTxHash;
  }, []);

  useEffect(() => {
    campaignsRef.current = campaigns;
  }, [campaigns]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const refreshCampaigns = useCallback((preserveVisibleList: boolean, visibleCampaigns?: CampaignCell[]) => {
    const activeVisibleCampaigns: CampaignCell[] = visibleCampaigns ?? campaignsRef.current;
    if (!preserveVisibleList) {
      setLoading(true);
    }

    setError("");
    setIsRefreshing(true);

    Promise.all([
      fetchCampaigns(client),
      fetch("/api/campaign-records", { cache: "no-store" }).then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.error ?? "Failed to fetch campaign records");
        }

        return Array.isArray(data?.records) ? (data.records as CampaignRecord[]) : [];
      }),
    ])
      .then(([chainCampaigns, records]) => {
        const nextRecordsByTxHash = buildRecordsByTxHash(records);

        if (!preserveVisibleList || activeVisibleCampaigns.length === 0) {
          setCampaigns(chainCampaigns);
          setRecordsByTxHash(nextRecordsByTxHash);
          setPendingCampaigns(null);
          setPendingRecordsByTxHash(null);
          setUnseenCampaignCount(0);
          return;
        }

        const currentKeys = new Set(activeVisibleCampaigns.map(getCampaignIdentity));
        let nextUnseenCount = 0;

        for (const campaign of chainCampaigns) {
          const key = getCampaignIdentity(campaign);
          if (currentKeys.has(key)) {
            break;
          }
          nextUnseenCount += 1;
        }

        if (nextUnseenCount > 0) {
          setPendingCampaigns(chainCampaigns);
          setPendingRecordsByTxHash(nextRecordsByTxHash);
          setUnseenCampaignCount(nextUnseenCount);
          return;
        }

        setCampaigns(chainCampaigns);
        setRecordsByTxHash(nextRecordsByTxHash);
        setPendingCampaigns(null);
        setPendingRecordsByTxHash(null);
        setUnseenCampaignCount(0);
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        onErrorChange(message);
      })
      .finally(() => {
        setLoading(false);
        setIsRefreshing(false);
      });
  }, [buildRecordsByTxHash, client, onErrorChange]);

  useEffect(() => {
    const loadTimer = setTimeout(() => {
      refreshCampaigns(false);
    }, 0);

    return () => {
      clearTimeout(loadTimer);
    };
  }, [refreshCampaigns]);

  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchOpen]);

  const handleRefresh = () => {
    refreshCampaigns(campaigns.length > 0, campaigns);
  };

  const handleSearchClick = () => {
    setIsSearchOpen((prev) => {
      const next = !prev;
      if (!next) {
        setSearchQuery("");
      }
      return next;
    });
  };

  const handleShowPendingCampaigns = () => {
    if (!pendingCampaigns || !pendingRecordsByTxHash) {
      return;
    }

    setCampaigns(pendingCampaigns);
    setRecordsByTxHash(pendingRecordsByTxHash);
    setPendingCampaigns(null);
    setPendingRecordsByTxHash(null);
    setUnseenCampaignCount(0);
    setShouldScrollToNewest(true);
  };

  const mergedCampaigns = useMemo<MergedCampaign[]>(() => {
    return campaigns.map((campaign) => ({
      campaign,
      record: recordsByTxHash[normalizeHash(campaign.outPoint.txHash)] ?? null,
      displayStatus: deriveDisplayStatus(campaign, nowMs),
    }));
  }, [campaigns, nowMs, recordsByTxHash]);

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredCampaigns = useMemo(() => {
    if (!normalizedSearchQuery) {
      return mergedCampaigns;
    }

    return mergedCampaigns.filter(({ campaign, record }) => {
      const creatorAddress = record?.creatorAddress ?? decodeCreatedByAddress(campaign);
      const creatorHandle = record?.creatorHandle ?? buildDefaultHandle(creatorAddress);
      const summary = record?.summaryDraft ?? decodeSummary(campaign.data.summary);
      const searchable = [
        record?.title,
        record?.description,
        summary,
        creatorAddress,
        creatorHandle,
        TYPE_LABELS[campaign.data.campaignType],
        TYPE_TAGS[campaign.data.campaignType],
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();

      return searchable.includes(normalizedSearchQuery);
    });
  }, [mergedCampaigns, normalizedSearchQuery]);

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="campaign-heading-row">
          <h2 className="text-lg sm:text-xl font-semibold">Freights</h2>
          {unseenCampaignCount > 0 && (
            <button
              type="button"
              className="campaign-refresh-badge"
              onClick={handleShowPendingCampaigns}
              aria-label={`Show ${unseenCampaignCount} new freights`}
            >
              {formatCompactCampaignCount(unseenCampaignCount)}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="campaign-action-btn"
            data-tooltip="Refresh freights"
          >
            <span className={`campaign-refresh-icon-wrap ${isRefreshing ? "refreshing" : ""}`}>
              <RefreshCw className="campaign-action-icon" size={24} strokeWidth={2} aria-hidden="true" />
            </span>
          </button>
          <div className={`campaign-search-wrapper ${isSearchOpen ? "active" : ""}`}>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search freights..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="campaign-search-input"
            />
          </div>
          <button
            onClick={handleSearchClick}
            className="campaign-action-btn"
            data-tooltip="Search freights"
          >
            <Search className="campaign-action-icon" size={24} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>

      <CampaignList
        campaigns={filteredCampaigns}
        client={client}
        loading={loading}
        error={error}
        shouldScrollToNewest={shouldScrollToNewest}
        onScrolledToNewest={() => setShouldScrollToNewest(false)}
        onCommentDiscardRequest={onCommentDiscardRequest}
        commentDiscardDecision={commentDiscardDecision}
        onTicketPurchaseRequest={onTicketPurchaseRequest}
        onSettlementInfoRequest={onSettlementInfoRequest}
        onSubmissionErrorRequest={onSubmissionErrorRequest}
      />
    </>
  );
}

function CampaignList({ campaigns, client, loading, error, shouldScrollToNewest, onScrolledToNewest, onCommentDiscardRequest, commentDiscardDecision, onTicketPurchaseRequest, onSettlementInfoRequest, onSubmissionErrorRequest }: { campaigns: MergedCampaign[]; client: ccc.Client; loading: boolean; error: string; shouldScrollToNewest: boolean; onScrolledToNewest: () => void; onCommentDiscardRequest: (cardId: string) => void; commentDiscardDecision: { cardId: string; discard: boolean } | null; onTicketPurchaseRequest: (campaign: CampaignCell) => void; onSettlementInfoRequest: (data: SettlementModalData) => void; onSubmissionErrorRequest: (message: string) => void; }) {
  const signer = ccc.useSigner();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [currentWalletAddress, setCurrentWalletAddress] = useState<string | null>(null);
  const newestCampaignRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
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
    let cancelled = false;

    void (async () => {
      if (!signer) {
        if (!cancelled) {
          setCurrentWalletAddress(null);
        }
        return;
      }

      try {
        const nextWalletAddress = await signer.getRecommendedAddress();
        if (!cancelled) {
          setCurrentWalletAddress(nextWalletAddress ?? null);
        }
      } catch {
        if (!cancelled) {
          setCurrentWalletAddress(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signer]);

  useEffect(() => {
    if (!shouldScrollToNewest) {
      return;
    }

    newestCampaignRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    onScrolledToNewest();
  }, [onScrolledToNewest, shouldScrollToNewest]);

  if (loading) {
    return <p className="text-sm text-gray-400">Loading freights…</p>;
  }

  if (error) {
    return <p className="text-sm text-gray-400">Sorry, an error occurred while loading freights</p>;
  }

  if (campaigns.length === 0) {
    return <p className="text-sm text-gray-400">No freights found on testnet yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {campaigns.map(({ campaign, record, displayStatus }, index) => (
        <div key={`${campaign.outPoint.txHash}:${campaign.outPoint.index}`} ref={index === 0 ? newestCampaignRef : null}>
          <CampaignCard
            campaign={campaign}
            record={record}
            displayStatus={displayStatus}
            signer={signer ?? null}
            client={client}
            currentWalletAddress={currentWalletAddress}
            nowMs={nowMs}
            isHighlighted={index === 99 && !!signer}
            onCommentDiscardRequest={onCommentDiscardRequest}
            commentDiscardDecision={commentDiscardDecision}
            onTicketPurchaseRequest={onTicketPurchaseRequest}
            onSettlementInfoRequest={onSettlementInfoRequest}
            onSubmissionErrorRequest={onSubmissionErrorRequest}
          />
        </div>
      ))}
    </div>
  );
}

function CampaignCard({
  campaign: c,
  record,
  displayStatus,
  signer,
  client,
  currentWalletAddress,
  nowMs,
  isHighlighted = false,
  onCommentDiscardRequest,
  commentDiscardDecision,
  onTicketPurchaseRequest,
  onSettlementInfoRequest,
  onSubmissionErrorRequest,
}: {
  campaign: CampaignCell;
  record: CampaignRecord | null;
  displayStatus: CampaignStatus;
  signer: ccc.Signer | null;
  client: ccc.Client;
  currentWalletAddress: string | null;
  nowMs: number;
  isHighlighted?: boolean;
  onCommentDiscardRequest: (cardId: string) => void;
  commentDiscardDecision: { cardId: string; discard: boolean } | null;
  onTicketPurchaseRequest: (campaign: CampaignCell) => void;
  onSettlementInfoRequest: (data: SettlementModalData) => void;
  onSubmissionErrorRequest: (message: string) => void;
}) {
  const { data, outPoint } = c;
  const cardId = `${outPoint.txHash}:${outPoint.index}`;
  const shortHash = outPoint.txHash.slice(0, 10) + "…";
  const createdAtDate = new Date(Number(data.createdAt)).toLocaleDateString();
  const maxCkb = formatCkbAmount(data.maximumAmount);
  const depositedCkb = formatCkbAmount(data.currentDeposits);
  const isRaffleCampaign = data.campaignType === 4;
  const ticketPriceShannons = data.auxAmount > 0n ? data.auxAmount : 0n;
  const totalTickets = isRaffleCampaign && ticketPriceShannons > 0n ? data.maximumAmount / ticketPriceShannons : 0n;
  const soldTickets = isRaffleCampaign && ticketPriceShannons > 0n ? data.currentDeposits / ticketPriceShannons : 0n;
  const remainingTickets = totalTickets > soldTickets ? totalTickets - soldTickets : 0n;
  const remainingDepositCapacity = data.maximumAmount > data.currentDeposits ? data.maximumAmount - data.currentDeposits : 0n;
  const onchainSummary = decodeSummary(data.summary);
  const creatorAddress = record?.creatorAddress || decodeCreatedByAddress(c);
  const creatorHandle = record?.creatorHandle || buildDefaultHandle(creatorAddress);
  const displayTitle = record?.title?.trim() || onchainSummary;
  const displayDescription = record?.description?.trim() || onchainSummary;
  const collapsedDescription = useMemo(
    () => truncateCampaignDescription(displayDescription, CAMPAIGN_CARD_PREVIEW_MAX_CHARS),
    [displayDescription]
  );
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const shouldShowReadMore = collapsedDescription.truncated;
  const visibleDescription = isDescriptionExpanded ? displayDescription : collapsedDescription.text;
  const descriptionLines = visibleDescription.length > 0 ? visibleDescription.split("\n") : [];
  const mentions = record?.socialMetadata?.mentions ?? [];
  const countdown = buildCampaignCountdown(c, nowMs);
  const countdownTitle = countdown.phase === "start" ? "Starts in" : countdown.phase === "duration" ? "Ends in" : "Ended";
  const countdownClassName = `campaign-card-countdown campaign-card-countdown-${countdown.tone}`;
  const hasReachedMaxAmount = remainingDepositCapacity <= 0n;
  const hasNoRemainingTickets = isRaffleCampaign && remainingTickets <= 0n;
  const isCampaignInactive = displayStatus === CampaignStatus.Completed || displayStatus === CampaignStatus.Cancelled;
  const hasNotStartedRaffle = isRaffleCampaign && displayStatus === CampaignStatus.Created;
  const rewardCountValue = Number(data.rewardCount);
  const initialComments = useMemo<CampaignComment[]>(() => (
    Array.isArray(record?.socialMetadata?.comments)
      ? record.socialMetadata.comments.filter((value): value is CampaignComment => !!value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string")
      : []
  ), [record?.socialMetadata?.comments]);
  const initialLikedByAddresses = useMemo(() => (
    Array.isArray(record?.socialMetadata?.likedByAddresses)
      ? record.socialMetadata.likedByAddresses.map((value) => normalizeHash(value)).filter(Boolean)
      : []
  ), [record?.socialMetadata?.likedByAddresses]);
  const normalizedCurrentWalletAddress = normalizeHash(currentWalletAddress);
  const [likes, setLikes] = useState(record?.socialMetadata?.likeCount ?? 0);
  const [likedByAddresses, setLikedByAddresses] = useState<string[]>(initialLikedByAddresses);
  const [bookmarks, setBookmarks] = useState(record?.socialMetadata?.bookmarkCount ?? 0);
  const [commentList, setCommentList] = useState<CampaignComment[]>(initialComments);
  const [reshares, setReshares] = useState(record?.socialMetadata?.reshareCount ?? 0);
  const [userBookmarked, setUserBookmarked] = useState(false);
  const [userReshared, setUserReshared] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "error">("idle");
  const [isCommentComposerOpen, setIsCommentComposerOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [isSavingLike, setIsSavingLike] = useState(false);
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [commentError, setCommentError] = useState("");
  const commentComposerRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [isDepositing, setIsDepositing] = useState(false);

  const isConnected = !!signer;
  const isPurchaseDisabled = !isConnected || isCampaignInactive || hasNotStartedRaffle || hasReachedMaxAmount || hasNoRemainingTickets;
  const comments = commentList.length;
  const userLiked = normalizedCurrentWalletAddress.length > 0 && likedByAddresses.includes(normalizedCurrentWalletAddress);
  const userCommented = normalizedCurrentWalletAddress.length > 0
    && commentList.some((comment) => normalizeHash(comment.creatorAddress) === normalizedCurrentWalletAddress);

  useEffect(() => {
    setLikes(record?.socialMetadata?.likeCount ?? 0);
    setLikedByAddresses(initialLikedByAddresses);
    setBookmarks(record?.socialMetadata?.bookmarkCount ?? 0);
    setCommentList(initialComments);
    setReshares(record?.socialMetadata?.reshareCount ?? 0);
  }, [
    initialComments,
    initialLikedByAddresses,
    record?.socialMetadata?.bookmarkCount,
    record?.socialMetadata?.likeCount,
    record?.socialMetadata?.reshareCount,
  ]);

  const buildCampaignRecordPayload = (nextSocialMetadata: {
    comments: CampaignComment[];
    likeCount: number;
    likedByAddresses: string[];
    bookmarkCount: number;
    reshareCount: number;
  }) => ({
    title: record?.title ?? displayTitle,
    description: record?.description ?? displayDescription,
    campaignType: record?.campaignType ?? data.campaignType,
    summaryDraft: record?.summaryDraft ?? onchainSummary,
    argsDraft: {
      taskStartDelayHours: record?.argsDraft?.taskStartDelayHours ?? String(Number(data.startDurationSecs) / 3600),
      taskDurationHours: record?.argsDraft?.taskDurationHours ?? String(Number(data.taskDurationSecs) / 3600),
      maxAmountCkb: record?.argsDraft?.maxAmountCkb ?? formatCkbAmount(data.maximumAmount),
      auxAmountCkb: record?.argsDraft?.auxAmountCkb ?? formatCkbAmount(data.auxAmount),
    },
    socialMetadata: {
      mentions,
      comments: nextSocialMetadata.comments,
      likeCount: nextSocialMetadata.likeCount,
      likedByAddresses: nextSocialMetadata.likedByAddresses,
      bookmarkCount: nextSocialMetadata.bookmarkCount,
      reshareCount: nextSocialMetadata.reshareCount,
    },
    creatorAddress: record?.creatorAddress ?? creatorAddress,
    creatorHandle: record?.creatorHandle ?? creatorHandle,
    status: record?.status ?? "published",
    txHash: record?.txHash ?? outPoint.txHash,
    publishError: record?.publishError ?? null,
  });

  useEffect(() => {
    if (!commentDiscardDecision || commentDiscardDecision.cardId !== cardId) {
      return;
    }

    if (commentDiscardDecision.discard) {
      setCommentDraft("");
      setCommentError("");
      setIsCommentComposerOpen(false);
    } else {
      setIsCommentComposerOpen(true);
    }
  }, [cardId, commentDiscardDecision]);

  const handleLike = async () => {
    if (!isConnected || !record?._id || !normalizedCurrentWalletAddress || isSavingLike) {
      return;
    }

    const previousLikedByAddresses = likedByAddresses;
    const previousLikeCount = likes;
    const nextLikedByAddresses = userLiked
      ? likedByAddresses.filter((address) => address !== normalizedCurrentWalletAddress)
      : [...likedByAddresses, normalizedCurrentWalletAddress];
    const nextLikeCount = nextLikedByAddresses.length;

    setLikedByAddresses(nextLikedByAddresses);
    setLikes(nextLikeCount);
    setIsSavingLike(true);

    try {
      const response = await fetch(`/api/campaign-records/${record._id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildCampaignRecordPayload({
          comments: commentList,
          likeCount: nextLikeCount,
          likedByAddresses: nextLikedByAddresses,
          bookmarkCount: bookmarks,
          reshareCount: reshares,
        })),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to save like");
      }
    } catch {
      setLikedByAddresses(previousLikedByAddresses);
      setLikes(previousLikeCount);
    } finally {
      setIsSavingLike(false);
    }
  };

  const handleBookmark = () => {
    if (!isConnected) return;
    setUserBookmarked(!userBookmarked);
    setBookmarks((prev) => (userBookmarked ? prev - 1 : prev + 1));
  };

  const handleComment = () => {
    if (!isConnected) return;
    setCommentError("");
    setIsCommentComposerOpen((current) => !current);
  };

  useEffect(() => {
    if (!isCommentComposerOpen) {
      return;
    }

    const handleOutsidePointerDown = (event: MouseEvent) => {
      if (!commentComposerRef.current) {
        return;
      }

      if (commentComposerRef.current.contains(event.target as Node)) {
        return;
      }

      if (commentDraft.trim().length === 0) {
        setCommentError("");
        setCommentDraft("");
        if (commentInputRef.current) {
          commentInputRef.current.style.height = "32px";
        }
        setIsCommentComposerOpen(false);
        return;
      }

      onCommentDiscardRequest(cardId);
    };

    document.addEventListener("mousedown", handleOutsidePointerDown);
    return () => {
      document.removeEventListener("mousedown", handleOutsidePointerDown);
    };
  }, [cardId, commentDraft, isCommentComposerOpen, onCommentDiscardRequest]);

  const handleSubmitComment = async () => {
    const nextCommentText = commentDraft.trim();
    if (!nextCommentText) {
      setCommentError("Comment cannot be empty");
      return;
    }

    if (!record?._id) {
      setCommentError("Comments are not available for this campaign yet");
      return;
    }

    setIsSavingComment(true);
    setCommentError("");

    try {
      if (!currentWalletAddress) {
        throw new Error("Unable to resolve wallet address for comment");
      }

      const nextComment: CampaignComment = {
        text: nextCommentText,
        creatorAddress: currentWalletAddress,
        creatorHandle: buildDefaultHandle(currentWalletAddress),
        createdAt: new Date().toISOString(),
      };
      const nextComments = [...commentList, nextComment];
      const response = await fetch(`/api/campaign-records/${record._id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildCampaignRecordPayload({
          comments: nextComments,
          likeCount: likes,
          likedByAddresses,
          bookmarkCount: bookmarks,
          reshareCount: reshares,
        })),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to save comment");
      }

      setCommentList(nextComments);
      setCommentDraft("");
      if (commentInputRef.current) {
        commentInputRef.current.style.height = "32px";
      }
      setIsCommentComposerOpen(false);
    } catch (error) {
      setCommentError(error instanceof Error ? error.message : "Failed to save comment");
    } finally {
      setIsSavingComment(false);
    }
  };

  const handleReshare = () => {
    if (!isConnected) return;
    setUserReshared(!userReshared);
    setReshares((prev) => (userReshared ? prev - 1 : prev + 1));
  };

  const handleCopyAddress = async () => {
    try {
      await copyText(creatorAddress);
      setCopyFeedback("copied");
      window.setTimeout(() => setCopyFeedback("idle"), 1200);
    } catch {
      setCopyFeedback("error");
      window.setTimeout(() => setCopyFeedback("idle"), 1200);
    }
  };

  const handleDepositClick = () => {
    if (isPurchaseDisabled) return;
    setShowDepositModal(true);
  };

  const handleDepositSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!signer || !depositAmount || isPurchaseDisabled) return;

    const amount = BigInt(Math.floor(parseFloat(depositAmount) * 100_000_000));
    if (amount <= 0n) {
      alert("Please enter a valid amount");
      return;
    }

    const maxAmount = data.maximumAmount - data.currentDeposits;
    if (amount > maxAmount) {
      alert(`Maximum deposit available: ${(Number(maxAmount) / 1e8).toFixed(2)} CKB`);
      return;
    }

    setIsDepositing(true);
    try {
      const txHash = await sendDeposit(signer, c, BigInt(Math.floor(parseFloat(depositAmount))));
      alert(`Deposit sent! Tx: ${txHash}`);
      setShowDepositModal(false);
      setDepositAmount("");
    } catch (error) {
      alert(`Deposit failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsDepositing(false);
    }
  };

  const hasCreatorPermissionForSettlement = isConnected && normalizeHash(currentWalletAddress) === normalizeHash(creatorAddress);
  const hasSettledRewards = isRaffleCampaign && displayStatus === CampaignStatus.Completed && data.currentDeposits === 0n;
  const shouldGlowSettlement = isRaffleCampaign && displayStatus === CampaignStatus.Completed && rewardCountValue > 0 && !hasSettledRewards;

  const handleSettlementClick = async () => {
    if (!isRaffleCampaign || !signer) {
      return;
    }

    try {
      const participants = await fetchParticipants(client, c);
      const randomnessHash = bytesToHex(data.randomnessHash);
      const randomnessPreimage = record?.randomnessPreimage ?? null;
      const revealedPreimage = randomnessPreimage ? hexToBytes(randomnessPreimage) : null;
      const winners = revealedPreimage
        ? previewDeterministicWinners(participants, data.rewardCount, revealedPreimage, c)
        : [];
      const recipientAddresses = winners.map((winner) => bytesToHex(winner.data.participantAddress));
      const evidenceItems = [
        `Stored randomness hash: ${randomnessHash}`,
        randomnessPreimage ? `Revealed preimage: ${randomnessPreimage}` : "Revealed preimage is not available in the current record store.",
        `Participant count used: ${String(participants.length)}`,
        `Reward count: ${String(data.rewardCount)}`,
        "Winner ordering is deterministic by join time, participant address, then outpoint.",
      ];

      let distributionTxHash: string | null = null;
      if (shouldGlowSettlement) {
        if (!hasCreatorPermissionForSettlement) {
          onSubmissionErrorRequest("Only the freight creator can distribute raffle rewards.");
          return;
        }
        if (!revealedPreimage) {
          onSubmissionErrorRequest("Randomness preimage is not available for settlement.");
          return;
        }
        distributionTxHash = await sendBatchDeliver(signer, c, winners, revealedPreimage);
      }

      onSettlementInfoRequest({
        campaignTitle: displayTitle,
        randomnessHash,
        randomnessPreimage,
        evidenceItems,
        recipients: recipientAddresses,
        distributionTxHash,
      });
    } catch (error) {
      onSubmissionErrorRequest(error instanceof Error ? error.message : "Failed to distribute raffle rewards");
    }
  };

  return (
    <div className="campaign-card-shell flex flex-col gap-0">
      <div className={`campaign-card-surface campaign-card-surface-sized border border-gray-200 rounded-lg p-4 flex flex-col gap-4 ${isHighlighted ? "campaign-card-highlighted" : ""}`.trim()}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <button
              type="button"
              onClick={handleCopyAddress}
              className="inline-flex items-center gap-1 text-xs font-mono text-gray-500 hover:text-gray-700"
              title={creatorAddress}
              aria-label="Copy creator address"
            >
              <Copy size={14} strokeWidth={2} aria-hidden="true" />
              <span>{truncateAddress(creatorAddress)}</span>
            </button>
            <span className="text-xs text-gray-400">{creatorHandle}</span>
            {copyFeedback === "copied" && <span className="text-[11px] text-green-600">Copied</span>}
            {copyFeedback === "error" && <span className="text-[11px] text-red-500">Copy failed</span>}
          </div>
          <div className="flex items-center gap-2">
            <span className={`status-indicator status-${getStatusClassName(displayStatus)}`} title={STATUS_LABELS[displayStatus] ?? String(displayStatus)} />
            {/* <span className="text-xs text-gray-500">{STATUS_LABELS[displayStatus] ?? String(displayStatus)}</span> */}
          </div>
        </div>

        <div className="flex flex-wrap items-baseline gap-2 text-xs text-gray-500">
          <span className="font-medium text-gray-800">{TYPE_LABELS[data.campaignType] ?? data.campaignType}</span>
          {isRaffleCampaign && ticketPriceShannons > 0n && (
            <>
              <span className="campaign-card-ticket-price">
                1 <Ticket className="campaign-card-inline-ticket" size={16} strokeWidth={2} aria-hidden="true" /> = {formatCkbAmount(ticketPriceShannons)} CKB
              </span>
              {data.rewardCount > 0n && (
                <>
                  <span className="font-medium text-gray-800">then:</span>
                  <span className={`campaign-card-ticket-price ${shouldGlowSettlement ? "campaign-card-ticket-price-pending" : "campaign-card-ticket-price-settled"}`}>take {String(data.rewardCount)}</span>
                </>
              )}
            </>
          )}
        </div>

        <div className="campaign-card-content">
          <h3 className="campaign-card-title text-xl font-semibold leading-tight text-gray-900">{displayTitle}</h3>
          <div className={`campaign-card-description-wrap ${isDescriptionExpanded ? "campaign-card-description-wrap-expanded" : ""}`}>
            <div className="campaign-card-description">
              {descriptionLines.map((line, index) => {
                const isQuote = /^\s*>/.test(line);
                const quoteText = line.replace(/^\s*>\s?/, "");

                if (isQuote) {
                  return (
                    <div key={`${line}-${index}`} className="campaign-card-description-quote">
                      {quoteText}
                    </div>
                  );
                }

                if (line.trim().length === 0) {
                  return <div key={`blank-${index}`} className="campaign-card-description-spacer" aria-hidden="true" />;
                }

                return (
                  <p key={`${line}-${index}`} className="campaign-card-description-line">
                    {line}
                  </p>
                );
              })}
            </div>
          </div>
          {shouldShowReadMore && (
            <button
              type="button"
              className="campaign-card-read-more"
              onClick={() => setIsDescriptionExpanded((current) => !current)}
            >
              {isDescriptionExpanded ? "Show less" : "Read more..."}
            </button>
          )}
        </div>

        {mentions.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {mentions.map((mention) => (
              <span key={mention} className="px-2 py-1 rounded border border-gray-300 text-gray-600">@{mention}</span>
            ))}
          </div>
        )}

        <div className="campaign-card-footer">
          <div className="campaign-card-footer-meta">
            <span className="text-xs font-mono text-gray-400 break-all">
              <a
                href={`https://pudge.explorer.nervos.org/transaction/${outPoint.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {shortHash}
              </a>
            </span>
            <span className="campaign-card-created-date">Created {createdAtDate}</span>
          </div>
          <span className={countdownClassName} title={countdownTitle} aria-label={`${countdownTitle} ${countdown.text}`}>
            {countdown.text}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3 pt-2 pb-3 text-xs">
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleLike()}
            className={`campaign-action-btn action-like ${userLiked ? "campaign-action-active" : ""} ${!isConnected ? "campaign-action-disabled" : ""}`}
            data-tooltip={!isConnected ? "Connect wallet to like" : "Like"}
          >
            <Heart className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
            <span className="campaign-action-count">{likes}</span>
          </button>

          <button
            onClick={handleBookmark}
            className={`campaign-action-btn action-bookmark ${userBookmarked ? "campaign-action-active" : ""} ${!isConnected ? "campaign-action-disabled" : ""}`}
            data-tooltip={!isConnected ? "Connect wallet to bookmark" : "Bookmark"}
          >
            <Bookmark className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
            <span className="campaign-action-count">{bookmarks}</span>
          </button>

          <button
            onClick={handleComment}
            className={`campaign-action-btn action-comment ${userCommented ? "campaign-action-active" : ""} ${!isConnected ? "campaign-action-disabled" : ""}`}
            data-tooltip={!isConnected ? "Connect wallet to comment" : "Comment"}
          >
            <MessageSquare className="campaign-action-icon" size={16} strokeWidth={2} aria-hidden="true" />
            <span className="campaign-action-count">{comments}</span>
          </button>

          <button
            onClick={handleReshare}
            className={`campaign-action-btn action-reshare ${userReshared ? "campaign-action-active" : ""} ${!isConnected ? "campaign-action-disabled" : ""}`}
            data-tooltip={!isConnected ? "Connect wallet to reshare" : "Reshare"}
          >
            <Repeat2 className="campaign-action-icon" size={22} strokeWidth={1.5} aria-hidden="true" />
            <span className="campaign-action-count">{reshares}</span>
          </button>

          {isRaffleCampaign && displayStatus === CampaignStatus.Completed && rewardCountValue > 0 && (
            <button
              type="button"
              onClick={() => void handleSettlementClick()}
              className={`campaign-action-btn action-winners ${shouldGlowSettlement ? "campaign-action-active" : ""}`}
              data-tooltip={shouldGlowSettlement ? "Distribute raffle rewards" : "View raffle settlement evidence"}
            >
              <Share2 className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
              <span className="campaign-action-count">{rewardCountValue}</span>
            </button>
          )}

          {hasNotStartedRaffle && (
            <button
              type="button"
              disabled
              className="campaign-action-btn ml-auto campaign-action-disabled"
              data-tooltip="Coming soon"
            >
              <Coins className="campaign-action-icon" size={16} strokeWidth={2} aria-hidden="true" />
              <span className="campaign-action-count font-mono">{depositedCkb} CKB</span>
            </button>
          )}

          <button
            onClick={isRaffleCampaign ? () => onTicketPurchaseRequest(c) : handleDepositClick}
            disabled={isPurchaseDisabled}
            className={`campaign-action-btn ${!hasNotStartedRaffle ? "ml-auto " : ""}${isPurchaseDisabled ? "campaign-action-disabled" : ""}`.trim()}
            data-tooltip={
              !isConnected
                ? (isRaffleCampaign ? "Connect wallet to buy tickets" : "Connect wallet to deposit")
                : isCampaignInactive
                  ? "Freight unavailable"
                  : hasNotStartedRaffle
                    ? "Raffle has not started"
                    : hasNoRemainingTickets
                      ? "No tickets left"
                      : hasReachedMaxAmount
                        ? "Max amount reached"
                        : (isRaffleCampaign ? "Buy tickets" : "Deposit CKB")
            }
          >
            {isRaffleCampaign ? (
              <>
                <Ticket className="campaign-action-icon" size={20} strokeWidth={2} aria-hidden="true" />
                <span className="campaign-action-count font-mono">{String(remainingTickets)} left</span>
              </>
            ) : (
              <>
                <Coins className="campaign-action-icon" size={20} strokeWidth={2} aria-hidden="true" />
                <span className="campaign-action-count font-mono">{depositedCkb} / {maxCkb} CKB</span>
              </>
            )}
          </button>
        </div>

        <div
          ref={commentComposerRef}
          className={`campaign-comment-composer ${isCommentComposerOpen ? "campaign-comment-composer-open" : "campaign-comment-composer-closed"}`}
          aria-hidden={!isCommentComposerOpen}
        >
          <div className="campaign-comment-input-wrap">
            <textarea
              ref={commentInputRef}
              value={commentDraft}
              onChange={(event) => {
                const nextValue = event.target.value.slice(0, 300);
                setCommentDraft(nextValue);
                event.currentTarget.value = nextValue;
                event.currentTarget.style.height = "auto";
                const nextHeight = Math.max(32, event.currentTarget.scrollHeight);
                event.currentTarget.style.height = `${nextHeight}px`;
              }}
              onFocus={(event) => {
                if (event.currentTarget.value.length > 0) {
                  event.currentTarget.select();
                }
              }}
              className="campaign-comment-input"
              placeholder="Write a comment..."
              rows={1}
              disabled={isSavingComment || !isCommentComposerOpen}
            />
            <button
              type="button"
              className="campaign-comment-submit"
              onClick={() => void handleSubmitComment()}
              disabled={isSavingComment || !commentDraft.trim() || !isCommentComposerOpen}
              aria-label="Submit comment"
            >
              <Check size={24} strokeWidth={3} aria-hidden="true" />
            </button>
          </div>
          <div className="campaign-comment-meta-row">
            <span className={`campaign-comment-count ${commentDraft.length >= 300 ? "campaign-comment-count-limit" : commentDraft.length >= 250 ? "campaign-comment-count-warn" : ""}`}>{300 - commentDraft.length}</span>
          </div>
          {commentError ? <p className="campaign-comment-error">{commentError}</p> : null}
        </div>
      </div>

      {showDepositModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-4">Deposit CKB</h3>
            <form onSubmit={handleDepositSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Amount (CKB)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={Number(data.maximumAmount - data.currentDeposits) / 1e8}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                  disabled={isDepositing || isPurchaseDisabled}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Max available: {(Number(data.maximumAmount - data.currentDeposits) / 1e8).toFixed(2)} CKB
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowDepositModal(false);
                    setDepositAmount("");
                  }}
                  disabled={isDepositing}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDepositing || !depositAmount || isPurchaseDisabled}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {isDepositing ? "Processing..." : "Deposit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
