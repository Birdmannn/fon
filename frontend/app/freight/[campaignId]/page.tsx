"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { CheckCircle, LoaderCircle } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import CampaignApprovalControls, { type FreightApprovalStatus } from "@/app/_components/CampaignApprovalControls";
import AppShellHeader from "@/app/_components/AppShellHeader";
import CampaignCommentsPanel from "@/app/_components/CampaignCommentsPanel";
import CampaignDetailSurface from "@/app/_components/CampaignDetailSurface";
import CampaignDetailInteractions from "@/app/_components/CampaignDetailInteractions";
import { useInfoError } from "@/app/_components/InfoErrorProvider";
import CampaignMountablesPanel, { CampaignMountableIcon, type CampaignMountableItem } from "@/app/_components/CampaignMountablesPanel";
import CampaignParticipantsStack from "@/app/_components/CampaignParticipantsStack";
import type { FreightTree } from "@/app/_components/FreightTreeInfo";
import FreightTreeDiagram from "@/app/_components/FreightTreeDiagram";
import FreightTreeHelpInfo from "@/app/_components/FreightTreeHelpInfo";
import FreightTreeZoomActions from "@/app/_components/FreightTreeZoomActions";
import RaffleSettlementInfo from "@/app/_components/RaffleSettlementInfo";
import CreateCampaignHeaderActions from "@/app/_components/CreateCampaignHeaderActions";
import CreateCampaignLauncher from "@/app/_components/CreateCampaignLauncher";
import CreateReviewMountablesInfo from "@/app/_components/CreateReviewMountablesInfo";
import RaffleApprovalConfigurator, { RaffleApprovalActions } from "@/app/_components/RaffleApprovalConfigurator";
import { ChildFreightMountableConfigurator, FormsMountableConfigurator, LockMountableConfigurator } from "@/app/_components/BuiltInMountableConfigurator";
import MountableAppsConfigurator from "@/app/_components/MountableAppsConfigurator";
import MountableOptionsCatalog from "@/app/_components/MountableOptionsCatalog";
import ThreeDotLoader from "@/app/_components/ThreeDotLoader";
import TagSuggestionsInfo from "@/app/_components/TagSuggestionsInfo";
import {
  CREATE_INFO_CONSTRAINT_HEADING,
  CREATE_INFO_CONSTRAINT_ITEMS,
  CREATE_INFO_NOTE_HEADING,
  CREATE_INFO_NOTE_ITEMS,
  CREATE_INFO_PREVIEW_HEADING,
  CREATE_INFO_TYPING_HEADING,
  CREATE_INFO_TYPING_ITEMS,
} from "@/app/_lib/createCampaignInfo";
import {
  appMountableSummary,
  isAppMountableEnabled,
  normalizeAppMountableConfigs,
} from "@/app/_lib/appMountable";
import { formsMountableSummary, isFormsMountableEnabled, normalizeFormsMountableConfig } from "@/app/_lib/formsMountable";
import { getMountableCriteriaStatus, hasRaffleTicketParticipation, type MountableCriterionStatus, type ParticipantCriterionRow } from "@/app/_lib/mountableCriteriaStatus";
import { childFreightMountableSummary } from "@/app/_lib/childFreightMountable";
import { getLockMountableValidationState, isLockMountableEnabled, lockMountableSummary, parseLockMinimumFbars } from "@/app/_lib/lockMountable";
import { markProfileAnalyticsDirty } from "@/app/_hooks/useProfileAnalytics";
import { markProfileFreightsDirty } from "@/app/_hooks/useProfileFreights";
import { markProfileTransactionsDirty } from "@/app/_hooks/useProfileTransactions";
import { useCreateCampaignFlow } from "@/app/_hooks/useCreateCampaignFlow";
import { useGoogleLink } from "@/app/_hooks/useGoogleLink";
import { useTicketPurchaseFlow } from "@/app/_hooks/useTicketPurchaseFlow";
import { useUserProfile } from "@/app/_hooks/useUserProfile";
import { useWalletInfo } from "@/app/_hooks/useWalletInfo";
import type { CampaignSupportRequest } from "@/app/_types/campaignSupport";
import type { CampaignRecord } from "@/app/_types/campaignRecords";
import type { SettlementModalData } from "@/app/_types/settlement";
import type { FormsMountableConfig } from "@/app/_types/formsMountable";
import { buildDefaultUsername, decodeCreatedByAddress, formatCkbAmount } from "@/lib/campaignDisplay";
import { FREIGHT_CREATION_FBARS_COST } from "@/lib/fbars";
import { markWalletSeedIntent } from "@/lib/walletSeed";
import { assertFreightParentPreflight } from "@/lib/freightParentPreflight";
import { isWinningCampaignType } from "@/lib/fbars";
import { CampaignType } from "@/lib/contract";
import { raffleApprovalsSatisfied } from "@/lib/raffleApproval";
import { isOnChainGiftApprovalSatisfied } from "@/lib/giftApproval";
import { findCampaignByRecord, getCampaignStableId, normalizeHash } from "@/lib/campaignIdentity";
import { countDirectChildren, parentIds } from "@/lib/freightTree";
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
const TYPE_LABELS = ["Simple Task", "FundedTask", "Crowdfunding", "Timed Challenge", "Raffle", "Recurring Raffle"];
const INSUFFICIENT_FBARS_MESSAGE = "Interact more on chain to improve FBARS.";

type InfoModalMode = "about" | "create-error" | "tag-suggestions" | "mountables" | "mountables-child-freight" | "mountables-forms" | "mountables-lock" | "mountables-apps" | "mountables-approval" | "save-draft-confirm" | "submission-success" | "insufficient-fbars" | "support-deposit" | "support-deposit-success" | "ticket-purchase" | "ticket-buy-success" | "creator-withdraw-success" | "raffle-settlement" | "criteria-status" | "freight-options" | "freight-relation-choice" | "freight-existing" | "freight-link-pending" | "freight-link-success" | "freight-link-error";
type FreightOption = "view-tree";
type FreightRelationChoice = "parent" | "child";
type OwnedFreight = { campaignId: string; title: string };

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
  const [settlementModalData, setSettlementModalData] = useState<SettlementModalData | null>(null);
  const [infoModalInteraction, setInfoModalInteraction] = useState<"hover" | "click">("hover");
  const [selectedFreightOption, setSelectedFreightOption] = useState<FreightOption | null>(null);
  const [isFreightTreeClosing, setIsFreightTreeClosing] = useState(false);
  const [freightTreeZoom, setFreightTreeZoom] = useState(0.75);
  const freightTreeCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [freightRelationChoice, setFreightRelationChoice] = useState<FreightRelationChoice | null>(null);
  const [isCreatingRelatedFreight, setIsCreatingRelatedFreight] = useState(false);
  const [ownedFreights, setOwnedFreights] = useState<OwnedFreight[]>([]);
  const [ownedFreightsLoading, setOwnedFreightsLoading] = useState(false);
  const [freightLinkBusy, setFreightLinkBusy] = useState(false);
  const [freightLinkError, setFreightLinkError] = useState("");
  const [pendingNewFreightId, setPendingNewFreightId] = useState<string | null>(null);
  const infoStepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [freightTree, setFreightTree] = useState<FreightTree | null>(null);
  const [freightTreeFeedback, setFreightTreeFeedback] = useState("");
  const [freightApprovalStatus, setFreightApprovalStatus] = useState<FreightApprovalStatus>({ message: "", busy: false });
  const [freightTreeError, setFreightTreeError] = useState(false);
  const [isLoadingFreightTree, setIsLoadingFreightTree] = useState(false);
  const freightTreeRequestRef = useRef<AbortController | null>(null);
  const directChildrenRequestRef = useRef<AbortController | null>(null);
  const [supportRequest, setSupportRequest] = useState<CampaignSupportRequest | null>(null);
  const [supportAmount, setSupportAmount] = useState("");
  const [supportError, setSupportError] = useState("");
  const [isProcessingSupport, setIsProcessingSupport] = useState(false);
  const [detailActionSuccessTxHash, setDetailActionSuccessTxHash] = useState("");
  const [criteriaStatuses, setCriteriaStatuses] = useState<MountableCriterionStatus[]>([]);
  const [hasRaffleTicket, setHasRaffleTicket] = useState<boolean | null>(null);
  const [isLoadingCriteria, setIsLoadingCriteria] = useState(false);
  const [criteriaError, setCriteriaError] = useState("");
  const detailActionSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  useInfoError(error);
  useInfoError(chainSyncError);
  useInfoError(formsClaimsError);
  useInfoError(participantFormsActionError);
  useInfoError(creatorFormsActionError);
  useInfoError(googleLinkError);
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
  const { currentUserProfile: freightCreatorProfile } = useUserProfile(null, null, normalizedCreatorAddress);
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
    const wasChangingStep = infoStepTimerRef.current !== null;
    if (infoStepTimerRef.current) {
      clearTimeout(infoStepTimerRef.current);
      infoStepTimerRef.current = null;
    }
    if (!showInfoModal || (isInfoModalClosing && !wasChangingStep)) {
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
    if (infoHideTimerRef.current || isInfoModalClosing) return;
    clearInfoCloseTimer();

    if (preventHoverOpen) {
      return;
    }

    if (showInfoModal && infoModalInteraction === "click") {
      return;
    }

    setInfoModalMode("about");
    setInfoModalInteraction("hover");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearInfoCloseTimer, infoModalInteraction, isInfoModalClosing, showInfoModal]);

  const keepInfoModalOpen = useCallback(() => {
    if (infoHideTimerRef.current || isInfoModalClosing) return;
    clearInfoCloseTimer();
  }, [clearInfoCloseTimer, isInfoModalClosing]);

  const scheduleCloseInfoModal = useCallback((preventAutoClose: boolean = false, onBeforeHide?: () => void) => {
    if (preventAutoClose || infoHideTimerRef.current || isInfoModalClosing) {
      return;
    }

    clearInfoCloseTimer();
    infoCloseTimerRef.current = setTimeout(() => {
      closeInfoModal(onBeforeHide);
    }, 120);
  }, [clearInfoCloseTimer, closeInfoModal, isInfoModalClosing]);

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
    lockMountableSelected,
    handleCreateTopRightAction,
    handleCreateErrorChange,
    handleDraftSelectionRequest,
    approvalSetup,
    continueApprovalSetup,
    openRaffleApprovalModal,
    updateApprovalSetup,
    handleMountableSelectionStateChange,
    handleSaveDraftChoice,
    handleToggleSelectedMountablePrinciple,
    handleUpdateSelectedMountablePrincipleParam,
    handleToggleMountableAppSelection,
    handleVerifySelectedMountableApp,
    isCreateDraftListOpen,
    isCreateModalClosing,
    isMountableFormFocused,
    isMountableLockFocused,
    isMountablesContinuing,
    isVerifyingMountableApp,
    mountedAppConfigs,
    handleTagSuggestionsRequested,
    handleTagSuggestionContinue,
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
    setLockMountableSelected,
    setIsCreateDraftListOpen,
    setIsMountableFormFocused,
    setIsMountableLockFocused,
    setIsMountablesContinuing,
    setMountableFormLinks,
    setMountableLockFbars,
    setMountableChildFreightTitle,
    setMountableLockRule,
    setMountableFormValidationState,
    setMountableLockValidationState,
    setMountablesPromptError,
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
    closeInfoModal,
    setInfoModalMode,
    setInfoModalInteraction,
    setIsInfoModalClosing,
    setShowInfoModal,
  });

  const clearDetailActionSuccessTimer = useCallback(() => {
    if (detailActionSuccessTimerRef.current) {
      clearTimeout(detailActionSuccessTimerRef.current);
      detailActionSuccessTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearDetailActionSuccessTimer, [clearDetailActionSuccessTimer]);

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
  }, [clearInfoCloseTimer, clearInfoHideTimer]);

  const openDetailActionSuccess = useCallback((txHash: string, mode: "ticket-buy-success" | "support-deposit-success" | "creator-withdraw-success") => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearDetailActionSuccessTimer();
    markCurrentProfileDataDirty();
    setDetailActionSuccessTxHash(txHash);
    if (mode === "support-deposit-success") {
      transitionFreightInfoModal(mode);
    } else {
      setInfoModalMode(mode);
      setIsInfoModalClosing(false);
      setShowInfoModal(true);
    }
    setInfoModalInteraction("click");
    detailActionSuccessTimerRef.current = setTimeout(
      () => closeInfoModal(() => setInfoModalMode("about")),
      3000 + (mode === "support-deposit-success" ? Math.max(120, INFO_MODAL_ANIMATION_MS - 500) : 0),
    );
  }, [clearDetailActionSuccessTimer, clearInfoCloseTimer, clearInfoHideTimer, closeInfoModal, markCurrentProfileDataDirty, transitionFreightInfoModal]);

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
    onSubmissionError: () => {},
    onTicketBuySuccess: (txHash) => openDetailActionSuccess(txHash, "ticket-buy-success"),
  });

  const handleOpenTicketPurchaseInfoModal = useCallback((
    campaign: CampaignCell,
    record: CampaignRecord,
    liveSoldTickets: bigint,
    remainingTickets: bigint,
    onTicketBought: (campaignId: string, ticketPrice: bigint, nextSoldTickets: bigint) => void,
  ) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearDetailActionSuccessTimer();
    openTicketPurchaseInfoModal(campaign, record, { liveSoldTickets, remainingTickets }, onTicketBought);
    setInfoModalMode("ticket-purchase");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearDetailActionSuccessTimer, clearInfoCloseTimer, clearInfoHideTimer, openTicketPurchaseInfoModal]);

  const handleOpenSupportInfoModal = useCallback((request: CampaignSupportRequest) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearDetailActionSuccessTimer();
    setSupportRequest(request);
    setSupportAmount("");
    setSupportError("");
    setIsProcessingSupport(false);
    setInfoModalMode("support-deposit");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearDetailActionSuccessTimer, clearInfoCloseTimer, clearInfoHideTimer]);

  const handleSupportSubmit = useCallback(async () => {
    if (!supportRequest || isProcessingSupport) return;
    setIsProcessingSupport(true);
    setSupportError("");
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      const txHash = await supportRequest.submit(supportAmount);
      openDetailActionSuccess(txHash, "support-deposit-success");
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : "Transaction failed");
    } finally {
      setIsProcessingSupport(false);
    }
  }, [isProcessingSupport, openDetailActionSuccess, supportAmount, supportRequest]);

  const isCreateStyleModalOpen = showCreateModal || selectedFreightOption !== null;
  const activeShellWidthClass = isCreateStyleModalOpen ? "campaign-shell-width" : shellWidthClass;
  const shouldHideWalletAction = (showCreateModal && !isCreateModalClosing) || (selectedFreightOption === "view-tree" && !isFreightTreeClosing);

  const resetInfoModalState = useCallback(() => {
    resetCreateInfoModalState();
    resetTicketPurchaseState();
    setSupportRequest(null);
    setSupportAmount("");
    setSupportError("");
    setCriteriaStatuses([]);
    setHasRaffleTicket(null);
    setCriteriaError("");
    setIsLoadingCriteria(false);
    setSettlementModalData(null);
    if (infoModalMode === "raffle-settlement") setInfoModalMode("about");
    clearDetailActionSuccessTimer();
  }, [clearDetailActionSuccessTimer, infoModalMode, resetCreateInfoModalState, resetTicketPurchaseState]);

  const handleViewerAvatarClick = useCallback(() => {
    if (!selectedRecord?.campaignId || !walletAddress) return;
    clearInfoCloseTimer();
    clearInfoHideTimer();
    clearDetailActionSuccessTimer();
    setCriteriaStatuses([]);
    setHasRaffleTicket(null);
    setCriteriaError("");
    setIsLoadingCriteria(true);
    setInfoModalMode("criteria-status");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearDetailActionSuccessTimer, clearInfoCloseTimer, clearInfoHideTimer, selectedRecord?.campaignId, walletAddress]);

  const handleOpenFreightOptions = useCallback(() => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    if (infoStepTimerRef.current) {
      clearTimeout(infoStepTimerRef.current);
      infoStepTimerRef.current = null;
    }
    freightTreeRequestRef.current?.abort();
    freightTreeRequestRef.current = null;
    setIsLoadingFreightTree(false);
    setFreightTreeFeedback("");
    setFreightTreeError(false);
    setFreightRelationChoice(null);
    setIsCreatingRelatedFreight(false);
    setFreightLinkError("");
    setInfoModalMode("freight-options");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, [clearInfoCloseTimer, clearInfoHideTimer]);

  useEffect(() => {
    if (!isCreatingRelatedFreight || showCreateModal || isCreateModalClosing) return;
    if (infoModalMode === "freight-link-pending" || infoModalMode === "freight-link-success" || infoModalMode === "freight-link-error") return;
    setIsCreatingRelatedFreight(false);
    setFreightRelationChoice(null);
  }, [infoModalMode, isCreateModalClosing, isCreatingRelatedFreight, showCreateModal]);

  useEffect(() => () => {
    if (infoStepTimerRef.current) clearTimeout(infoStepTimerRef.current);
  }, []);

  const handleOpenFreightRelationChoice = useCallback((relation: FreightRelationChoice) => {
    setFreightRelationChoice(relation);
    transitionFreightInfoModal("freight-relation-choice");
  }, [transitionFreightInfoModal]);

  const handleBackToFreightOptions = useCallback(() => {
    setFreightRelationChoice(null);
    transitionFreightInfoModal("freight-options");
  }, [transitionFreightInfoModal]);

  useEffect(() => {
    if (infoModalMode !== "freight-existing" || !selectedRecord?.campaignId || !walletAddress) return;
    const controller = new AbortController();
    setOwnedFreightsLoading(true);
    setFreightLinkError("");
    fetch(`/api/freights/tree?campaignId=${encodeURIComponent(selectedRecord.campaignId)}&ownedBy=${encodeURIComponent(walletAddress)}`, {
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
  }, [infoModalMode, selectedRecord?.campaignId, walletAddress]);

  const handleSelectFreightOption = useCallback((option: FreightOption) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    const openFreightOption = () => {
      setInfoModalMode("about");
      setIsFreightTreeClosing(false);
      setFreightTreeZoom(0.75);
      setSelectedFreightOption(option);
    };
    if (showInfoModal) closeInfoModal(openFreightOption);
    else openFreightOption();
  }, [clearInfoCloseTimer, clearInfoHideTimer, closeInfoModal, showInfoModal]);

  const handleViewFreightTree = useCallback(async () => {
    const campaignId = selectedRecord?.campaignId;
    if (!campaignId || isLoadingFreightTree) return;
    const controller = new AbortController();
    freightTreeRequestRef.current?.abort();
    freightTreeRequestRef.current = controller;
    setIsLoadingFreightTree(true);
    setFreightTreeFeedback("");
    setFreightTreeError(false);
    try {
      const response = await fetch(`/api/freights/tree?campaignId=${encodeURIComponent(campaignId)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json() as FreightTree & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to load freight tree");
      if (controller.signal.aborted) return;
      if (payload.nodes.length <= 1) {
        setFreightTreeFeedback("No freights are linked to this freight");
        return;
      }
      setFreightTree(payload);
      handleSelectFreightOption("view-tree");
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
  }, [handleSelectFreightOption, isLoadingFreightTree, selectedRecord?.campaignId]);

  useEffect(() => {
    const campaignId = selectedRecord?.campaignId?.trim().toLowerCase();
    if (!campaignId) return;
    const controller = new AbortController();
    directChildrenRequestRef.current = controller;
    fetch(`/api/freights/tree?campaignId=${encodeURIComponent(campaignId)}`, {
      cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return;
      const tree = await response.json() as FreightTree;
      if (!controller.signal.aborted) setFreightTree(tree);
    }).catch(() => undefined);
    return () => {
      controller.abort();
      if (directChildrenRequestRef.current === controller) directChildrenRequestRef.current = null;
    };
  }, [selectedRecord?.campaignId]);

  const closeFreightTree = useCallback(() => {
    if (selectedFreightOption !== "view-tree" || isFreightTreeClosing) return;
    setIsFreightTreeClosing(true);
    freightTreeCloseTimerRef.current = setTimeout(() => {
      setSelectedFreightOption(null);
      setIsFreightTreeClosing(false);
      freightTreeCloseTimerRef.current = null;
    }, INFO_MODAL_ANIMATION_MS);
  }, [isFreightTreeClosing, selectedFreightOption]);

  useEffect(() => () => {
    if (freightTreeCloseTimerRef.current) clearTimeout(freightTreeCloseTimerRef.current);
  }, []);

  useEffect(() => {
    if (selectedFreightOption !== "view-tree") return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeFreightTree();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeFreightTree, selectedFreightOption]);

  useEffect(() => {
    const campaignId = selectedRecord?.campaignId;
    if (!showInfoModal || isInfoModalClosing || infoModalMode !== "criteria-status" || !campaignId || !walletAddress) return;
    const controller = new AbortController();
    let latestRequest = 0;
    const loadCriteria = async () => {
      const request = ++latestRequest;
      try {
        const query = new URLSearchParams({ campaignId, participantAddress: walletAddress, includeChildFreight: "1" });
        const response = await fetch(`/api/campaign-participants?${query}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null) as { participants?: ParticipantCriterionRow[]; childFreightSatisfied?: boolean; error?: string } | null;
        if (!response.ok) throw new Error(payload?.error ?? "Unable to load criteria");
        if (controller.signal.aborted || request !== latestRequest) return;
        const participantRows = Array.isArray(payload?.participants) ? payload.participants : [];
        setHasRaffleTicket(hasRaffleTicketParticipation(participantRows));
        setCriteriaStatuses(getMountableCriteriaStatus({
          record: selectedRecord,
          rows: participantRows,
          viewerFbars: currentUserProfile?.fbars,
          creatorFbars: freightCreatorProfile?.fbars,
          signableCleared: selectedRecord.raffleApproval ? !!selectedCampaign?.data.approval && raffleApprovalsSatisfied(selectedCampaign.data.approval) : isOnChainGiftApprovalSatisfied(selectedRecord.giftDeliverable, selectedCampaign?.data.approval),
          childFreightSatisfied: payload?.childFreightSatisfied,
        }));
        setCriteriaError("");
      } catch (error) {
        if (!controller.signal.aborted && request === latestRequest) {
          setCriteriaError(error instanceof Error ? error.message : "Unable to load criteria");
        }
      } finally {
        if (!controller.signal.aborted && request === latestRequest) setIsLoadingCriteria(false);
      }
    };
    void loadCriteria();
    const intervalId = window.setInterval(() => void loadCriteria(), 15_000);
    return () => {
      controller.abort();
      window.clearInterval(intervalId);
    };
  }, [currentUserProfile?.fbars, freightCreatorProfile?.fbars, infoModalMode, isInfoModalClosing, selectedRecord, selectedCampaign, showInfoModal, walletAddress]);

  const openInsufficientFbarsInfoModal = useCallback((fromFreightRelationChoice = false) => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    if (fromFreightRelationChoice) {
      transitionFreightInfoModal("insufficient-fbars");
    } else {
      setInfoModalMode("insufficient-fbars");
      setInfoModalInteraction("click");
      setIsInfoModalClosing(false);
      setShowInfoModal(true);
    }
    infoCloseTimerRef.current = setTimeout(() => {
      closeInfoModal(resetInfoModalState);
    }, 3000 + (fromFreightRelationChoice ? Math.max(120, INFO_MODAL_ANIMATION_MS - 500) : 0));
  }, [
    clearInfoCloseTimer,
    clearInfoHideTimer,
    closeInfoModal,
    resetInfoModalState,
    setInfoModalInteraction,
    setIsInfoModalClosing,
    setShowInfoModal,
    transitionFreightInfoModal,
  ]);

  const preventInfoHover = infoModalMode === "create-error"
    || infoModalMode === "raffle-settlement"
    || infoModalMode === "freight-options"
    || infoModalMode === "freight-relation-choice"
    || infoModalMode === "freight-existing"
    || infoModalMode === "freight-link-pending"
    || infoModalMode === "freight-link-success"
    || infoModalMode === "freight-link-error"
    || infoModalMode === "tag-suggestions"
    || infoModalMode === "save-draft-confirm"
    || infoModalMode === "mountables"
    || infoModalMode === "mountables-child-freight"
    || infoModalMode === "mountables-lock"
    || infoModalMode === "mountables-forms"
    || infoModalMode === "mountables-approval" || infoModalMode === "mountables-apps"
    || infoModalMode === "submission-success"
    || infoModalMode === "support-deposit"
    || infoModalMode === "support-deposit-success"
    || infoModalMode === "ticket-purchase"
    || infoModalMode === "ticket-buy-success"
    || infoModalMode === "creator-withdraw-success"
    || infoModalMode === "criteria-status";

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

  useEffect(() => {
    const onChainUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ campaign: CampaignCell }>).detail;
      if (!detail?.campaign) return;
      setSelectedCampaign((current) => current && getCampaignStableId(current) === getCampaignStableId(detail.campaign) ? detail.campaign : current);
    };
    window.addEventListener("freight:approval-chain-update", onChainUpdate);
    return () => window.removeEventListener("freight:approval-chain-update", onChainUpdate);
  }, []);

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

  const linkFreight = useCallback(async (otherCampaignId: string, relation: FreightRelationChoice) => {
    const campaignId = selectedRecord?.campaignId;
    if (!campaignId) throw new Error("Current freight is unavailable");
    const signed = await createSignedWalletAction("freight-tree");
    const response = await fetch("/api/freights/tree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...signed, campaignId, otherCampaignId, relation }),
    });
    const payload = await response.json() as FreightTree & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Unable to link freight");
    directChildrenRequestRef.current?.abort();
    setFreightTree(payload);
    const currentNode = payload.nodes.find((node) => node.campaignId.toLowerCase() === campaignId.toLowerCase());
    if (currentNode) setSelectedRecord((current) => current ? { ...current, parentCampaignId: currentNode.parentCampaignId ?? null, parentCampaignIds: currentNode.parentCampaignIds ?? null } : current);
    markCurrentProfileDataDirty();
  }, [createSignedWalletAction, markCurrentProfileDataDirty, selectedRecord?.campaignId]);

  const handleLinkExistingFreight = useCallback(async (otherCampaignId: string) => {
    if (!freightRelationChoice || freightLinkBusy) return;
    setFreightLinkBusy(true);
    setFreightLinkError("");
    try {
      await linkFreight(otherCampaignId, freightRelationChoice);
      transitionFreightInfoModal("freight-link-success");
    } catch (error) {
      setFreightLinkError(error instanceof Error ? error.message : "Unable to link freight");
    } finally {
      setFreightLinkBusy(false);
    }
  }, [freightLinkBusy, freightRelationChoice, linkFreight, transitionFreightInfoModal]);

  const handleLinkNewFreight = useCallback(async (campaignId: string) => {
    if (!freightRelationChoice) return;
    setPendingNewFreightId(campaignId);
    setFreightLinkError("");
    setInfoModalMode("freight-link-pending");
    setInfoModalInteraction("click");
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
    try {
      await linkFreight(campaignId, freightRelationChoice);
      transitionFreightInfoModal("freight-link-success");
      setPendingNewFreightId(null);
    } catch (error) {
      setFreightLinkError(error instanceof Error ? error.message : "Unable to link the new freight");
      transitionFreightInfoModal("freight-link-error");
    }
  }, [freightRelationChoice, linkFreight, transitionFreightInfoModal]);

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
              raffleSupportPoolPercent: selectedRecord.argsDraft?.raffleSupportPoolPercent ?? "0",
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
            liveSoldTicketCount: selectedRecord.liveSoldTicketCount ?? null,
            settledParticipantCount: selectedRecord.settledParticipantCount ?? null,
            settledRecipients: selectedRecord.settledRecipients ?? null,
            withdrawalTxHash: selectedRecord.withdrawalTxHash ?? null,
            withdrawnAt: selectedRecord.withdrawnAt ?? null,
            withdrawnByAddress: selectedRecord.withdrawnByAddress ?? null,
            withdrawnAmountShannons: selectedRecord.withdrawnAmountShannons ?? null,
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
  }, [createSignedWalletAction, formsMountableConfig, mountedFormsId, openWalletWithSeed, refreshLinkedGoogleGrant, selectedRecord, signer]);

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
      if (!selectedRecord.campaignId) throw new Error("This freight is missing its campaign id");
      await assertFreightParentPreflight(selectedRecord.campaignId, await signer.getRecommendedAddress());
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
  }, [createSignedWalletAction, linkedIdentityEmail, loadFormsClaims, openWalletWithSeed, selectedRecord?._id, selectedRecord?.campaignId, signer]);

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
    const childFreightMountable = selectedRecord?.mountables?.childFreight;
    const appMountables = normalizeAppMountableConfigs(selectedRecord?.mountables?.apps ?? null)
      .filter((entry) => isAppMountableEnabled(entry));

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

    if (childFreightMountable?.enabled) {
      items.push({
        description: childFreightMountableSummary(childFreightMountable),
        icon: "child-freight",
        key: "child-freight",
        title: "Child Freight",
      });
    }

    if ((selectedRecord?.giftDeliverable?.approvers?.length ?? 0) > 0 || selectedRecord?.raffleApproval || selectedCampaign?.data.approval) {
      items.push({
        description: "Requires signing to deliver.",
        icon: "signable",
        key: "signable",
        title: "Signable",
      });
    }

    if (isWinningCampaignType(selectedCampaign?.data.campaignType ?? selectedRecord?.campaignType ?? -1)) {
      items.push({
        description: "May reward participants with CKB.",
        icon: "rewardable",
        key: "rewardable",
        title: "Rewardable",
      });
    }

    appMountables.forEach((appMountable) => {
      const metadata = [
        appMountable.installationLabel ? `Install ${appMountable.installationLabel}` : "",
        appMountable.selectedPrinciples.length > 0 ? `${appMountable.selectedPrinciples.length} principle${appMountable.selectedPrinciples.length === 1 ? "" : "s"}` : "",
        appMountable.supportsTimestampQuery ? "As-of queries supported" : "",
        appMountable.lastSyncAt ? `Last sync ${new Date(appMountable.lastSyncAt).toLocaleDateString()}` : "",
      ].filter(Boolean);

      items.push({
        description: appMountableSummary(appMountable),
        href: appMountable.appUrl || undefined,
        icon: "app",
        key: appMountable.mountableInstanceId || `${appMountable.appId}:${appMountable.installationId}`,
        logoUrl: appMountable.logoUrl || appMountable.iconUrl,
        metadata,
        proofInstructions: appMountable.adminNotice?.trim() || undefined,
        title: appMountable.appName || appMountable.appId || "Mounted app",
      });
    });

    return items.sort((left, right) => left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: "base" }));
  }, [formsMountableActions, selectedCampaign?.data.approval, selectedRecord?.raffleApproval, selectedCampaign?.data.campaignType, selectedRecord?.campaignType, selectedRecord?.giftDeliverable?.approvers?.length, selectedRecord?.mountables?.apps, selectedRecord?.mountables?.childFreight, selectedRecord?.mountables?.forms, selectedRecord?.mountables?.lock]);

  const detailCampaignType = selectedCampaign?.data.campaignType ?? selectedRecord?.campaignType ?? 0;
  const detailTypeLabel = TYPE_LABELS[detailCampaignType] ?? `Type ${detailCampaignType}`;
  const detailUsesRaffleRandomness = detailCampaignType === CampaignType.Raffle || detailCampaignType === CampaignType.RecurringRaffle;
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

  const passedCriteriaCount = criteriaStatuses.filter((criterion) => criterion.cleared).length;
  const currentFreightId = selectedRecord?.campaignId?.trim().toLowerCase();
  const directChildCount = freightTree && freightTree.currentCampaignId.toLowerCase() === currentFreightId
    ? countDirectChildren(currentFreightId, freightTree.nodes)
    : null;
  const latestDirectChildId = freightTree && freightTree.currentCampaignId.toLowerCase() === currentFreightId
    ? freightTree.nodes
        .filter((node) => parentIds(node).includes(currentFreightId))
        .sort((left, right) => {
          const leftCreatedAt = Number(left.chainCreatedAt) || Date.parse(left.chainCreatedAt ?? "") || 0;
          const rightCreatedAt = Number(right.chainCreatedAt) || Date.parse(right.chainCreatedAt ?? "") || 0;
          return rightCreatedAt - leftCreatedAt || right.campaignId.localeCompare(left.campaignId);
        })[0]?.campaignId ?? null
    : null;
  const infoModalBody = selectedFreightOption === "view-tree" && infoModalMode === "about" ? (
    <FreightTreeHelpInfo />
  ) : infoModalMode === "tag-suggestions" ? (
    <TagSuggestionsInfo initialQuery={tagSuggestionQuery} onContinue={handleTagSuggestionContinue} />
  ) : infoModalMode === "raffle-settlement" ? (
    <RaffleSettlementInfo data={settlementModalData} walletAddress={walletAddress} />
  ) : infoModalMode === "freight-options" ? (
    <div className="create-info-constraints-copy campaign-freight-options-heading-row">
      <p className="create-review-section-label campaign-freight-options-heading">Freight Options:</p>
      {selectedCampaign && freightApprovalStatus.message ? (
        <p className="create-review-section-label campaign-freight-options-feedback campaign-freight-options-action-status" role="status">
          {freightApprovalStatus.busy ? <LoaderCircle className="animate-spin" size={14} aria-hidden="true" /> : null}
          {freightApprovalStatus.message}
        </p>
      ) : freightTreeFeedback ? (
        <p className={`create-review-section-label campaign-freight-options-feedback${freightTreeError ? " campaign-freight-options-feedback-error" : ""}`} role={freightTreeError ? "alert" : "status"}>
          {freightTreeFeedback}
        </p>
      ) : null}
    </div>
  ) : infoModalMode === "freight-relation-choice" ? (
    <div className="create-info-constraints-copy">
      <p className="create-review-section-label">
        {freightRelationChoice === "parent" ? "Add Parent:" : "Add Child:"}
      </p>
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
  ) : infoModalMode === "criteria-status" ? (
    <div className="create-info-constraints-copy">
      <div className="campaign-criteria-heading">
        <p className="create-review-section-label text-gray-900">Participation Constraints:</p>
        <span className={`create-review-section-label campaign-criteria-progress${criteriaStatuses.length > 0 && passedCriteriaCount === criteriaStatuses.length ? " campaign-criteria-progress-complete" : ""}`}>
          {passedCriteriaCount}/{criteriaStatuses.length}
        </span>
      </div>
      {isLoadingCriteria ? (
        <div className="create-info-skeleton-list" role="status" aria-label="Loading criteria">
          <span className="create-info-skeleton-line" />
          <span className="create-info-skeleton-line" />
        </div>
      ) : criteriaError ? (
        <p className="create-info-constraint-item text-red-500" role="alert"><span>{criteriaError}</span></p>
      ) : criteriaStatuses.length > 0 ? (
        criteriaStatuses.map((criterion) => {
          const content = (
            <>
              <CampaignMountableIcon item={{ icon: criterion.icon, logoUrl: criterion.logoUrl, title: criterion.mountable }} className="campaign-criteria-mountable-icon" />
              <span className="campaign-criteria-copy">
                <span className="campaign-criteria-name">{criterion.mountable} / {criterion.principle}</span>
                <span className="campaign-criteria-description">{criterion.description}</span>
              </span>
              <span className={`campaign-criteria-status ${criterion.cleared ? "campaign-criteria-status-cleared" : "campaign-criteria-status-pending"}`}
                role="img" aria-label={criterion.cleared ? "Cleared" : "Pending"} data-tooltip={criterion.cleared ? "Cleared" : "Pending"} />
            </>
          );
          const rowClassName = `create-info-constraint-item campaign-criteria-row${criterion.cleared ? " campaign-criteria-row-cleared" : ""}`;
          return criterion.href ? (
            <a key={criterion.key} href={criterion.href} target="_blank" rel="noopener noreferrer"
              className={`${rowClassName} campaign-criteria-row-link`} aria-label={`Open ${criterion.mountable}: ${criterion.principle}`}>
              {content}
            </a>
          ) : (
            <div key={criterion.key} className={rowClassName}>{content}</div>
          );
        })
      ) : (
        <p className="create-info-constraint-item text-gray-500"><span>No clearable criteria.</span></p>
      )}
      {!isLoadingCriteria && !criteriaError && detailUsesRaffleRandomness && hasRaffleTicket === false ? (
        <p className="create-info-constraint-item campaign-criteria-ticket-missing" role="status">
          <span>{selectedCampaign?.data.auxAmount === 0n ? "You haven't entered this raffle yet." : "You haven't bought a raffle ticket yet."}</span>
        </p>
      ) : null}
    </div>
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
  ) : infoModalMode === "ticket-buy-success" || infoModalMode === "support-deposit-success" || infoModalMode === "creator-withdraw-success" ? (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label" style={{ color: "#16a34a" }}>
        {infoModalMode === "creator-withdraw-success" ? "Withdrawal successful" : infoModalMode === "ticket-buy-success" ? "Buy successful" : supportRequest?.supportMode === "direct_creator" ? "Tip successful" : "Deposit successful"}
      </p>
      <p className="create-info-constraint-item text-gray-500 font-mono break-all">
        <span className="text-gray-400">txhash: </span>
        <a href={`https://pudge.explorer.nervos.org/transaction/${detailActionSuccessTxHash}`} target="_blank" rel="noopener noreferrer" className="underline">
          {detailActionSuccessTxHash}
        </a>
      </p>
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
        {supportError ? <p className="create-review-section-label create-info-inline-status text-red-500" role="alert">{supportError}</p> : null}
      </div>
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
  ) : showCreateModal && infoModalMode === "mountables-approval" ? (
    <RaffleApprovalConfigurator config={approvalSetup} onChange={updateApprovalSetup} errorMessage={mountablesPromptError} onBack={() => goBackMountableSetup("approval")} busy={isMountablesContinuing} />
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
      closeInfoModal(resetInfoModalState);
      void createModalContentRef.current?.advanceToReviewAfterMountableSelection();
    } catch (error) {
      setMountablesPromptError(error instanceof Error ? error.message : `Failed to ignore mounted ${kind}`);
    } finally {
      setIsMountablesContinuing(false);
    }
  };

  const freightOptionsButtons = (
    <div className="create-info-confirm-actions campaign-freight-options-actions">
      {([ ["create-parent", "Add Parent"], ["create-child", "Add Child"], ["view-tree", "View Tree"] ] as const).map(([option, label]) => (
        <button key={option} type="button" data-option={option} className={`create-info-confirm-btn${option === "view-tree" ? " create-info-confirm-btn-primary" : ""}`} disabled={option === "view-tree" && isLoadingFreightTree}
          onClick={() => option === "view-tree" ? void handleViewFreightTree() : handleOpenFreightRelationChoice(option === "create-parent" ? "parent" : "child")}>
          {label}
        </button>
      ))}
    </div>
  );

  const infoModalActions = infoModalMode === "tag-suggestions" ? (
    <div className="create-info-confirm-actions">
      <button type="submit" form="tag-suggestions-form" className="create-info-confirm-btn create-info-confirm-btn-primary">
        Continue
      </button>
    </div>
  ) : infoModalMode === "freight-options" ? (
    selectedCampaign ? (
      <CampaignApprovalControls campaign={selectedCampaign} record={selectedRecord} signer={signer ?? null} nowMs={nowMs} placement="options" onStatusChange={setFreightApprovalStatus}>
        {freightOptionsButtons}
      </CampaignApprovalControls>
    ) : freightOptionsButtons
  ) : infoModalMode === "freight-relation-choice" ? (
    <div className="create-info-confirm-actions campaign-freight-options-actions">
      <button type="button" className="create-info-confirm-btn" onClick={handleBackToFreightOptions}>Back</button>
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
      <button type="button" className="create-info-confirm-btn create-info-confirm-btn-primary" onClick={() => closeInfoModal(resetInfoModalState)}>Done</button>
    </div>
  ) : infoModalMode === "freight-link-error" && pendingNewFreightId ? (
    <div className="create-info-confirm-actions">
      <button type="button" className="create-info-confirm-btn create-info-confirm-btn-primary" onClick={() => void handleLinkNewFreight(pendingNewFreightId)}>Retry link</button>
    </div>
  ) : infoModalMode === "support-deposit" ? (
    <form className="create-info-confirm-actions" onSubmit={(event) => { event.preventDefault(); void handleSupportSubmit(); }}>
      <div className="create-info-ticket-input-wrap">
        <input type="number" min="0.01" step="0.01" inputMode="decimal" value={supportAmount}
          onChange={(event) => { setSupportAmount(event.target.value); if (supportError) setSupportError(""); }}
          onFocus={(event) => { if (event.currentTarget.value.length > 0) event.currentTarget.select(); }}
          className="create-info-ticket-input create-info-ticket-input-with-suffix" aria-label="Amount in CKB" placeholder="0.00" disabled={isProcessingSupport} autoFocus />
        <span className="create-info-ticket-input-suffix">CKB</span>
      </div>
      <button type="submit" className="create-info-confirm-btn create-info-confirm-btn-primary" disabled={isProcessingSupport}>
        {isProcessingSupport ? "Processing..." : "Continue"}
      </button>
    </form>
  ) : infoModalMode === "ticket-purchase" ? (
    <form className="create-info-confirm-actions" onSubmit={(event) => { event.preventDefault(); void handleTicketPurchaseSubmit(); }}>
      <input type="number" min="1" step="1" inputMode="numeric" value={ticketPurchaseQuantity}
        onChange={(event) => { setTicketPurchaseQuantity(event.target.value); if (ticketPurchaseError) setTicketPurchaseError(""); }}
        onFocus={(event) => { if (event.currentTarget.value.length > 0) event.currentTarget.select(); }}
        className="create-info-ticket-input" aria-label="Number of tickets" disabled={isPurchasingTickets} />
      <button type="submit" className="create-info-confirm-btn create-info-confirm-btn-primary" disabled={isPurchasingTickets}>
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
            closeInfoModal(resetInfoModalState);
            await createModalContentRef.current?.advanceToReviewAfterMountableSelection();
          } catch (error) {
            setMountablesPromptError(error instanceof Error ? error.message : "Failed to save child freight mountable");
          } finally {
            setIsMountablesContinuing(false);
          }
        })();
      }}>Continue</button>
    </div>
  ) : showCreateModal && infoModalMode === "mountables-approval" ? (
    <RaffleApprovalActions onContinue={() => void continueApprovalSetup()} busy={isMountablesContinuing} />
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

              closeInfoModal(resetInfoModalState);
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

              closeInfoModal(resetInfoModalState);
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
                closeInfoModal(resetInfoModalState);
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
              closeInfoModal(resetInfoModalState);
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

    if (selectedCampaign) {
      return (
        <CampaignDetailInteractions
          campaign={selectedCampaign}
          record={selectedRecord}
          client={client}
          signer={signer ?? null}
          walletAddress={walletAddress}
          viewerFbars={currentUserProfile?.fbars}
          creatorFbars={freightCreatorProfile?.fbars}
          walletPhotoUpdatedAt={currentUserProfile?.photoUpdatedAt ?? null}
          nowMs={nowMs}
          mountableItems={mountableItems}
          onProfileDataChanged={markCurrentProfileDataDirty}
          onWithdrawalSuccess={(txHash) => openDetailActionSuccess(txHash, "creator-withdraw-success")}
          onViewerAvatarClick={() => void handleViewerAvatarClick()}
          onFreightOptionsClick={handleOpenFreightOptions}
          onFreightTreeClick={() => void handleViewFreightTree()}
          onSettlementInfoRequest={(data) => {
            clearInfoCloseTimer();
            clearInfoHideTimer();
            setSettlementModalData(data);
            setInfoModalMode("raffle-settlement");
            setInfoModalInteraction("click");
            setIsInfoModalClosing(false);
            setShowInfoModal(true);
          }}
          threadRole={parentIds(selectedRecord).length > 0 ? "child" : "parent"}
          directChildCount={directChildCount}
          threadNodeTargetId={parentIds(selectedRecord)[0] ?? latestDirectChildId}
          onSupportRequest={handleOpenSupportInfoModal}
          onTicketPurchaseRequest={handleOpenTicketPurchaseInfoModal}
        />
      );
    }

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
              campaignId={selectedRecord.campaignId}
              walletAddress={walletAddress}
              fallbackAddress={creatorAddress}
              showHeader={false}
              showEmptyState={false}
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
            <CampaignParticipantsStack
              campaignId={selectedRecord?.campaignId ?? null}
              walletAddress={walletAddress}
              walletPhotoUpdatedAt={currentUserProfile?.photoUpdatedAt ?? null}
              onViewerAvatarClick={() => void handleViewerAvatarClick()}
            />
          </div>
        </section>
      </div>
    );
  })();

  return (
    <main className="campaign-detail-page">
      <div className={`campaign-detail-shell ${activeShellWidthClass}`.trim()}>
        <AppShellHeader
          className={`campaign-shell-header ${activeShellWidthClass} ${isCreateStyleModalOpen ? "campaign-shell-header-transparent" : ""} fixed top-0 left-4 right-4 z-[70] mx-auto flex flex-row items-center justify-between gap-4`.trim()}
          infoButtonAriaLabel="Open Freight information"
          infoModalAriaLabel={infoModalMode === "mountables-approval" ? "Raffle approval setup" : selectedFreightOption === "view-tree" && infoModalMode === "about" ? "Linked freight information" : infoModalMode === "freight-relation-choice" ? freightRelationChoice === "parent" ? "Add Parent" : "Add Child" : infoModalMode === "freight-existing" ? "Select existing freight" : infoModalMode.startsWith("freight-link-") ? "Freight link status" : infoModalMode === "freight-options" ? "Freight options" : infoModalMode === "criteria-status" ? "Criteria" : infoModalMode === "raffle-settlement" ? "Raffle settlement details" : infoModalMode === "ticket-purchase" ? "Buy raffle tickets" : infoModalMode === "support-deposit" ? supportRequest?.supportMode === "direct_creator" ? "Tip creator" : "Deposit CKB" : infoModalMode === "ticket-buy-success" ? "Buy successful" : infoModalMode === "creator-withdraw-success" ? "Withdrawal successful" : infoModalMode === "support-deposit-success" ? "Support transaction successful" : infoModalMode === "tag-suggestions" ? "Tag suggestions" : infoModalMode === "create-error" ? "Create freight errors" : infoModalMode === "insufficient-fbars" ? "Not enough FBARS" : "Freight information modal"}
          infoModalBackdropAriaLabel={infoModalMode === "save-draft-confirm" ? "Return to create freight modal" : infoModalMode === "ticket-purchase" ? "Close ticket purchase modal" : infoModalMode === "support-deposit" ? "Close support modal" : "Close Freight information modal"}
          infoModalBackdropInteractive={((infoModalInteraction === "click" && infoModalMode !== "create-error") || infoModalMode === "save-draft-confirm" || infoModalMode === "submission-success") && infoModalMode !== "freight-link-pending" && !freightLinkBusy}
          infoModalBody={infoModalBody}
          infoModalActions={infoModalActions}
          infoModalClosing={isInfoModalClosing}
          infoModalOpen={showInfoModal}
          isConnected={Boolean(signer)}
          onConnect={openWalletWithSeed}
          onContainerClick={(event) => {
            if (event.target !== event.currentTarget) return;
            if (showInfoModal) {
              if (infoModalMode !== "create-error" && infoModalMode !== "freight-link-pending" && !freightLinkBusy && !(infoModalMode === "ticket-purchase" && isPurchasingTickets) && !(infoModalMode === "support-deposit" && isProcessingSupport)) {
                closeInfoModal(resetInfoModalState);
              }
            } else if (selectedFreightOption === "view-tree") {
              closeFreightTree();
            } else if (showCreateModal) {
              requestCloseCreateModal();
            }
          }}
          onCopyWalletAddress={() => void handleCopyWalletAddress()}
          onDisconnect={disconnect}
          onInfoButtonBlur={() => scheduleCloseInfoModal(preventInfoHover, resetInfoModalState)}
          onInfoButtonClick={() => handleReturnToFeed()}
          onInfoButtonFocus={() => openInfoModalFromHover(preventInfoHover)}
          onInfoModalKeepOpen={keepInfoModalOpen}
          onInfoModalRequestClose={() => {
            if (infoModalMode !== "create-error" && infoModalMode !== "freight-link-pending" && !freightLinkBusy && !(infoModalMode === "ticket-purchase" && isPurchasingTickets) && !(infoModalMode === "support-deposit" && isProcessingSupport)) {
              if (infoModalMode === "freight-options") freightTreeRequestRef.current?.abort();
              closeInfoModal(resetInfoModalState);
            }
          }}
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
          ) : selectedFreightOption === "view-tree" ? (
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
        onApprovalSetupRequired={openRaffleApprovalModal}
          onTagSuggestionsRequested={handleTagSuggestionsRequested}
          onMountableSelectionStateChange={handleMountableSelectionStateChange}
          onOpenCreateModal={() => { setIsCreatingRelatedFreight(false); setFreightRelationChoice(null); openCreateModal(); }}
          onPreviewErrorChange={handleCreateErrorChange}
          onPublishSuccess={(txHash, _randomnessPreimage, campaignId) => {
            finalizeCloseCreateModal();
            markCurrentProfileDataDirty();
            if (freightRelationChoice) void handleLinkNewFreight(campaignId);
            else openSubmissionSuccessInfoModal(txHash);
          }}
          onRequestCloseCreateModal={requestCloseCreateModal}
          onStepChange={setCreateModalStep}
          showCreateModal={showCreateModal}
          isCreateModalClosing={isCreateModalClosing}
          availableFbars={currentUserProfile?.fbars}
        />
        {selectedFreightOption === "view-tree" && selectedRecord?.campaignId ? (
          <>
            <button type="button" className={`create-campaign-backdrop ${isFreightTreeClosing ? "create-campaign-backdrop-closing" : ""}`} aria-label="Close freight tree modal" onClick={closeFreightTree} />
            <div className={`create-campaign-modal campaign-freight-tree-modal campaign-freight-tree-modal-diagram ${isFreightTreeClosing ? "create-campaign-modal-closing" : ""}`} role="dialog" aria-modal="true" aria-label="Freight tree">
              {freightTree ? <FreightTreeDiagram tree={freightTree} zoom={freightTreeZoom} /> : null}
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
