"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { Check, CheckCircle, DollarSign, LockKeyhole, Scroll } from "lucide-react";
import { useParams } from "next/navigation";
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
import { formsMountableSummary, isFormsMountableEnabled } from "@/app/_lib/formsMountable";
import { canAccessLockMountable, getLockMountableBypassFbars, getLockMountableValidationState, isLockMountableEnabled, lockMountableSummary, parseLockMinimumFbars } from "@/app/_lib/lockMountable";
import { useCreateCampaignFlow } from "@/app/_hooks/useCreateCampaignFlow";
import { useUserProfile } from "@/app/_hooks/useUserProfile";
import { useWalletInfo } from "@/app/_hooks/useWalletInfo";
import type { CampaignRecord } from "@/app/_types/campaignRecords";
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

const DETAIL_EXPANDING_FLAG = "freight:detail-expanding";
const DETAIL_CONTRACTING_FLAG = "freight:detail-contracting";
const SHELL_TRANSITION_MS = 420;
const DETAIL_CAMPAIGN_FETCH_LIMIT = 200;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TYPE_LABELS = ["Simple Task", "FundedTask", "Crowdfunding", "Timed Challenge", "Raffle"];
const INSUFFICIENT_FBARS_MESSAGE = "Interact more on chain to improve FBARS.";

type InfoModalMode = "about" | "mountables" | "mountables-forms" | "mountables-lock" | "save-draft-confirm" | "submission-success" | "insufficient-fbars";

export default function CampaignDetailPage() {
  const { open, disconnect, client } = ccc.useCcc();
  const openWalletWithSeed = useCallback(() => {
    markWalletSeedIntent();
    open();
  }, [open]);
  const signer = ccc.useSigner();
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
  const walletActionHref = useMemo(() => {
    const nextUsername = currentUserProfile?.username?.trim() || (walletAddress ? buildDefaultUsername(walletAddress) : "");
    return nextUsername ? `/user/${encodeURIComponent(nextUsername)}` : undefined;
  }, [currentUserProfile?.username, walletAddress]);
  const canEditLightModePrimaryColor = Boolean(signer && walletAddress && currentUserProfile?.address === walletAddress);

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
      window.location.href = "/";
    }, SHELL_TRANSITION_MS);
  }, []);


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

  const comments = useMemo(() => (
    Array.isArray(selectedRecord?.socialMetadata?.comments)
      ? selectedRecord.socialMetadata.comments.filter((value): value is { text: string; creatorAddress?: string | null; creatorHandle?: string | null; createdAt?: string } => (
        !!value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string"
      ))
      : []
  ), [selectedRecord?.socialMetadata?.comments]);

  const mountableItems = useMemo<CampaignMountableItem[]>(() => {
    const items: CampaignMountableItem[] = [];
    const formsMountable = selectedRecord?.mountables?.forms;
    const lockMountable = selectedRecord?.mountables?.lock;

    if (formsMountable && isFormsMountableEnabled(formsMountable)) {
      const metadata = [
        formsMountable.formId ? `Form ID ${formsMountable.formId}` : "",
        formsMountable.validatedAt ? `Validated ${new Date(formsMountable.validatedAt).toLocaleDateString()}` : "",
      ].filter(Boolean);

      items.push({
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
  }, [selectedRecord?.mountables?.forms, selectedRecord?.mountables?.lock]);

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
