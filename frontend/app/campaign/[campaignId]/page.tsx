"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { Check, CheckCircle, Copy, DollarSign, LockKeyhole, Scroll } from "lucide-react";
import { useParams } from "next/navigation";
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import CampaignCommentsPanel from "@/app/_components/CampaignCommentsPanel";
import CampaignDetailSurface from "@/app/_components/CampaignDetailSurface";
import CreateCampaignHeaderActions from "@/app/_components/CreateCampaignHeaderActions";
import CreateCampaignLauncher from "@/app/_components/CreateCampaignLauncher";
import FreightInfoModal from "@/app/_components/FreightInfoModal";
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
import { useCreateCampaignFlow } from "@/app/_hooks/useCreateCampaignFlow";
import type { CampaignRecord } from "@/app/_types/campaignRecords";
import { decodeCreatedByAddress, formatCkbAmount } from "@/lib/campaignDisplay";
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

function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return Promise.reject(new Error("Clipboard API unavailable"));
}

function truncateWalletAddress(address: string) {
  if (address.length <= 22) {
    return address;
  }

  return `${address.slice(0, 10)}…${address.slice(-10)}`;
}

const DETAIL_EXPANDING_FLAG = "freight:detail-expanding";
const DETAIL_CONTRACTING_FLAG = "freight:detail-contracting";
const SHELL_TRANSITION_MS = 420;
const DETAIL_CAMPAIGN_FETCH_LIMIT = 200;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type InfoModalMode = "about" | "mountables" | "mountables-forms" | "save-draft-confirm" | "submission-success";

export default function CampaignDetailPage() {
  const { open, disconnect, client } = ccc.useCcc();
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
  const [walletAddress, setWalletAddress] = useState("");
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [walletInfoError, setWalletInfoError] = useState("");
  const [walletInfoLoading, setWalletInfoLoading] = useState(false);
  const [walletCopyFeedback, setWalletCopyFeedback] = useState<"idle" | "copied" | "error">("idle");
  const [walletBalanceIncreasing, setWalletBalanceIncreasing] = useState(false);
  const walletBalanceAnimationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, [showInfoModal, isInfoModalClosing]);

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
  }, [infoModalInteraction, isInfoModalClosing, showInfoModal]);

  const keepInfoModalOpen = useCallback(() => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  }, []);

  const scheduleCloseInfoModal = useCallback((preventAutoClose: boolean = false, onBeforeHide?: () => void) => {
    if (preventAutoClose) {
      return;
    }

    clearInfoCloseTimer();
    infoCloseTimerRef.current = setTimeout(() => {
      closeInfoModal(onBeforeHide);
    }, 120);
  }, [closeInfoModal]);

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

  const closeWalletInfoModal = useCallback(() => {
    if (!showWalletInfoModal || isWalletInfoClosing) {
      return;
    }

    setIsWalletInfoClosing(true);
    window.setTimeout(() => {
      setShowWalletInfoModal(false);
      setIsWalletInfoClosing(false);
    }, 220);
  }, [isWalletInfoClosing, showWalletInfoModal]);

  const keepWalletInfoModalOpen = useCallback(() => {
    setIsWalletInfoClosing(false);
    setShowWalletInfoModal(true);
  }, []);

  const scheduleWalletInfoModalClose = useCallback(() => {
    window.setTimeout(() => {
      closeWalletInfoModal();
    }, 250);
  }, [closeWalletInfoModal]);

  const walletChainLabel = useMemo(() => {
    if (client instanceof ccc.ClientPublicMainnet) {
      return "Mainnet";
    }

    if (client instanceof ccc.ClientPublicTestnet) {
      return "Testnet";
    }

    return "Custom";
  }, [client]);

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
    resetCreateInfoModalState,
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
    showCreateModal,
    submissionSuccessPreimage,
    submissionSuccessTxHash,
    transitionMountablesModal,
  } = useCreateCampaignFlow<InfoModalMode>({
    animationMs: INFO_MODAL_ANIMATION_MS,
    initialInfoModalMode: "about",
    openWallet: open,
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

  const preventInfoHover = infoModalMode === "save-draft-confirm"
    || infoModalMode === "mountables"
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
    return () => {
      if (walletBalanceAnimationTimerRef.current) {
        clearTimeout(walletBalanceAnimationTimerRef.current);
        walletBalanceAnimationTimerRef.current = null;
      }
    };
  }, []);

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
    if (!signer) {
      setShowWalletInfoModal(false);
      setWalletAddress("");
      setWalletBalance(null);
      setWalletInfoError("");
      setWalletInfoLoading(false);
      setWalletBalanceIncreasing(false);
      if (walletBalanceAnimationTimerRef.current) {
        clearTimeout(walletBalanceAnimationTimerRef.current);
        walletBalanceAnimationTimerRef.current = null;
      }
      return;
    }

    if (!showWalletInfoModal) {
      return;
    }

    let cancelled = false;

    const syncWalletInfo = async () => {
      setWalletInfoLoading(true);
      setWalletInfoError("");

      try {
        const [nextAddress, nextBalance] = await Promise.all([
          signer.getRecommendedAddress(),
          signer.getBalance(),
        ]);

        if (cancelled) {
          return;
        }

        setWalletAddress(nextAddress ?? "");
        setWalletBalance((previousBalance) => {
          if (previousBalance !== null && nextBalance > previousBalance) {
            setWalletBalanceIncreasing(true);
            if (walletBalanceAnimationTimerRef.current) {
              clearTimeout(walletBalanceAnimationTimerRef.current);
            }
            walletBalanceAnimationTimerRef.current = setTimeout(() => {
              setWalletBalanceIncreasing(false);
              walletBalanceAnimationTimerRef.current = null;
            }, 900);
          }

          return nextBalance;
        });
      } catch (walletError) {
        if (cancelled) {
          return;
        }

        setWalletInfoError(walletError instanceof Error ? walletError.message : "Unable to load wallet details");
      } finally {
        if (!cancelled) {
          setWalletInfoLoading(false);
        }
      }
    };

    void syncWalletInfo();
    const intervalId = window.setInterval(() => {
      void syncWalletInfo();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [showWalletInfoModal, signer]);

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

  const headerBody = (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">Freight details</p>
      <p className="create-info-constraint-item text-gray-500">
        <span>Browse a freight in full, then jump back to the feed when you are done.</span>
      </p>
      <p className="create-info-constraint-item text-gray-500">
        <span>Use the shared create composer here without leaving this detail page.</span>
      </p>
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
          className="campaign-detail-post-column campaign-detail-card-shell campaign-card-entry"
          style={{ "--campaign-card-enter-delay": "0ms" } as CSSProperties}
        >
          <CampaignDetailSurface
            campaign={selectedCampaign}
            chainSyncError={chainSyncError}
            isChainSyncing={isChainSyncing}
            nowMs={nowMs}
            record={selectedRecord}
          />
        </section>

        <section
          className="campaign-detail-comments-column campaign-card-entry"
          style={{ "--campaign-card-enter-delay": "110ms" } as CSSProperties}
        >
          <CampaignCommentsPanel comments={comments} fallbackAddress={creatorAddress} />
        </section>
      </div>
    );
  })();

  return (
    <main className="campaign-detail-page">
      <div className={`campaign-detail-shell ${shellWidthClass}`.trim()}>
        <div className={`campaign-shell-header ${shellWidthClass} fixed top-8 left-4 right-4 z-[70] mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`.trim()}>
          <div className="header-info-wrap">
            <div onMouseEnter={() => openInfoModalFromHover(preventInfoHover)} onMouseLeave={() => scheduleCloseInfoModal(preventInfoHover, resetInfoModalState)}>
              <button
                type="button"
                className="header-info-btn"
                aria-label="Open Freight information"
                onClick={() => handleReturnToFeed()}
                onFocus={() => openInfoModalFromHover(preventInfoHover)}
                onBlur={() => scheduleCloseInfoModal(preventInfoHover, resetInfoModalState)}
              >
                <span className="header-info-inner-ring" aria-hidden="true" />
                <span className="header-info-glyph" aria-hidden="true">i</span>
              </button>
            </div>
          </div>

          <div className="header-right-actions">
            {showCreateModal ? (
              <CreateCampaignHeaderActions
                createModalStep={createModalStep}
                isCreateDraftListOpen={isCreateDraftListOpen}
                isCreateModalClosing={isCreateModalClosing}
                onReset={resetCreateModal}
                onSecondaryAction={handleCreateTopRightAction}
              />
            ) : null}
            <div className="wallet-action-slot">
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
                        <span className="wallet-info-label">
                          Address <span className="wallet-chain-indicator wallet-chain-indicator-inline">({walletChainLabel})</span>
                        </span>
                        <div className="wallet-info-address-row">
                          <span className="wallet-info-address">{walletAddress ? truncateWalletAddress(walletAddress) : "Loading…"}</span>
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
                      <div className="wallet-info-section">
                        <span className="wallet-info-label">Balance</span>
                        <div className="wallet-info-balance-row">
                          <span className={`wallet-info-value ${walletBalanceIncreasing ? "wallet-balance-increasing" : ""}`.trim()}>
                            {walletBalance !== null ? `${formatCkbAmount(walletBalance)} CKB` : walletInfoLoading ? "Loading…" : "--"}
                          </span>
                          <span className="wallet-info-balance-approx">≈</span>
                          <span className={`wallet-info-usd ${walletBalanceIncreasing ? "wallet-balance-increasing" : ""}`.trim()}>
                            <span className="wallet-info-usd-currency">$</span>
                            <span>--</span>
                            <span className="wallet-info-usd-decimals">--</span>
                          </span>
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
            ariaLabel="Freight information modal"
            body={infoModalBody}
            actions={infoModalActions}
            backdropAriaLabel={infoModalMode === "save-draft-confirm" ? "Return to create freight modal" : "Close Freight information modal"}
            backdropInteractive={infoModalInteraction === "click" || infoModalMode === "save-draft-confirm" || infoModalMode === "submission-success"}
            onRequestClose={() => closeInfoModal(resetInfoModalState)}
            onKeepOpen={keepInfoModalOpen}
            onScheduleClose={() => scheduleCloseInfoModal(preventInfoHover, resetInfoModalState)}
          />
        </div>

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
          onMountableSelectionRequired={openMountablesModal}
          onMountableSelectionStateChange={({ formsSelected }) => {
            setFormsMountableSelected(formsSelected);
          }}
          onOpenCreateModal={openCreateModal}
          onPreviewErrorChange={setPreviewError}
          onPublishSuccess={(txHash, randomnessPreimage) => {
            finalizeCloseCreateModal();
            openSubmissionSuccessInfoModal(txHash, randomnessPreimage);
          }}
          onRequestCloseCreateModal={requestCloseCreateModal}
          onStepChange={setCreateModalStep}
          showCreateModal={showCreateModal}
          isCreateModalClosing={isCreateModalClosing}
        />
      </div>
    </main>
  );
}
