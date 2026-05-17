"use client";

import {
  ArrowLeft,
  Bookmark,
  CheckCircle,
  Coins,
  Copy,
  Eye,
  EyeOff,
  Heart,
  MessageSquare,
  Plus,
  RefreshCw,
  Repeat2,
  RotateCcw,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { ccc } from "@ckb-ccc/connector-react";
import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import CreateCampaignModalContent, { CreateConstraintStatus, CreateModalStep } from "@/app/create/_components/CreateCampaignModalContent";
import { FREIGHT_CONTRACT, CampaignStatus } from "@/lib/contract";
import { fetchCampaigns, sendDeposit, CampaignCell } from "@/lib/transactions";
import { bytesToHex, decodeSummary } from "@/lib/encoding";

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

const STATUS_LABELS = ["Created", "Active", "Completed", "Cancelled"];
const TYPE_LABELS = ["Simple Task", "Funded Task", "Crowdfunding", "Timed Challenge", "Raffle"];
const TYPE_TAGS = ["SimpleTask", "FundedTask", "Crowdfunding", "TimedChallenge", "Raffle"];
const MOUNTABLES_PLACEHOLDER_MESSAGE = "NO MOUNTABLES YET. RAFFLE RAFFLE RAFFLE.   ";

type CampaignRecord = {
  _id?: string;
  title?: string;
  description?: string;
  campaignType?: number;
  summaryDraft?: string;
  socialMetadata?: {
    mentions?: string[];
    comments?: unknown[];
    likeCount?: number;
    bookmarkCount?: number;
    reshareCount?: number;
  };
  creatorAddress?: string | null;
  creatorHandle?: string | null;
  status?: "draft" | "published" | "publish_failed";
  txHash?: string | null;
};

type MergedCampaign = {
  campaign: CampaignCell;
  record: CampaignRecord | null;
  displayStatus: CampaignStatus;
};

type ChainName = "mainnet" | "testnet" | "unknown";

function normalizeHash(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

function deriveDisplayStatus(campaign: CampaignCell) {
  if (campaign.data.status === CampaignStatus.Cancelled || campaign.data.status === CampaignStatus.Completed) {
    return campaign.data.status;
  }

  const createdAtSeconds = Number(campaign.data.createdAt) / 1000;
  const nowSeconds = Date.now() / 1000;
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

function formatDurationLabel(totalSeconds: number) {
  if (totalSeconds <= 0) {
    return "0h";
  }

  if (totalSeconds % 3600 === 0) {
    return `${totalSeconds / 3600}h`;
  }

  const hours = totalSeconds / 3600;
  return `${hours.toFixed(1)}h`;
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

function deriveChainName(source: unknown): ChainName {
  if (!source || typeof source !== "object") {
    return "unknown";
  }

  const constructorName = source.constructor?.name?.toLowerCase?.() ?? "";
  if (constructorName.includes("testnet")) {
    return "testnet";
  }
  if (constructorName.includes("mainnet")) {
    return "mainnet";
  }

  try {
    const objectText = JSON.stringify(
      source,
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      0
    ).toLowerCase();

    if (objectText.includes("testnet")) {
      return "testnet";
    }
    if (objectText.includes("mainnet")) {
      return "mainnet";
    }
  } catch {
    return "unknown";
  }

  return "unknown";
}

function chainLabel(chain: ChainName) {
  switch (chain) {
    case "mainnet":
      return "Mainnet";
    case "testnet":
      return "Testnet";
    default:
      return "Unknown";
  }
}

export default function Home() {
  const { open, disconnect, client } = ccc.useCcc();
  const signer = ccc.useSigner();
  const INFO_MODAL_ANIMATION_MS = 620;
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [isInfoModalClosing, setIsInfoModalClosing] = useState(false);
  const [infoModalInteraction, setInfoModalInteraction] = useState<"hover" | "click">("hover");
  const [activeInfoButtonRect, setActiveInfoButtonRect] = useState<DOMRect | null>(null);
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [isWalletModalClosing, setIsWalletModalClosing] = useState(false);
  const [walletButtonRect, setWalletButtonRect] = useState<DOMRect | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletBalance, setWalletBalance] = useState("");
  const [isBalanceVisible, setIsBalanceVisible] = useState(true);
  const [copiedAddress, setCopiedAddress] = useState(false);
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
  const infoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const infoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedAddressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerInfoButtonRef = useRef<HTMLButtonElement>(null);
  const walletButtonRef = useRef<HTMLButtonElement>(null);

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

  const clearWalletCloseTimer = () => {
    if (walletCloseTimerRef.current) {
      clearTimeout(walletCloseTimerRef.current);
      walletCloseTimerRef.current = null;
    }
  };

  const clearWalletHideTimer = () => {
    if (walletHideTimerRef.current) {
      clearTimeout(walletHideTimerRef.current);
      walletHideTimerRef.current = null;
    }
  };

  const clearCopiedAddressTimer = () => {
    if (copiedAddressTimerRef.current) {
      clearTimeout(copiedAddressTimerRef.current);
      copiedAddressTimerRef.current = null;
    }
  };

  const clearCreateHideTimer = () => {
    if (createHideTimerRef.current) {
      clearTimeout(createHideTimerRef.current);
      createHideTimerRef.current = null;
    }
  };

  const refreshHeaderInfoButtonRect = useCallback(() => {
    const button = headerInfoButtonRef.current;
    if (!button) return;

    setActiveInfoButtonRect(button.getBoundingClientRect());
  }, []);

  const refreshWalletButtonRect = useCallback(() => {
    const button = walletButtonRef.current;
    if (!button) return;

    setWalletButtonRect(button.getBoundingClientRect());
  }, []);

  const showInfoModalForInteraction = (interaction: "hover" | "click") => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    refreshHeaderInfoButtonRect();
    setInfoModalInteraction(interaction);
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  };

  const openInfoModalFromHover = () => {
    clearInfoCloseTimer();
    clearInfoHideTimer();

    if (showInfoModal && infoModalInteraction === "click" && !isInfoModalClosing) {
      return;
    }

    showInfoModalForInteraction("hover");
  };

  const keepInfoModalOpen = () => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  };

  const closeInfoModal = useCallback(() => {
    clearInfoCloseTimer();

    if (!showInfoModal || isInfoModalClosing) return;

    setIsInfoModalClosing(true);
    clearInfoHideTimer();
    infoHideTimerRef.current = setTimeout(() => {
      setShowInfoModal(false);
      setIsInfoModalClosing(false);
      setInfoModalInteraction("hover");
      setActiveInfoButtonRect(null);
      infoHideTimerRef.current = null;
    }, INFO_MODAL_ANIMATION_MS);
  }, [showInfoModal, isInfoModalClosing]);

  const openWalletModalFromHover = () => {
    clearWalletCloseTimer();
    clearWalletHideTimer();
    refreshWalletButtonRect();
    setIsWalletModalClosing(false);
    setShowWalletModal(true);
  };

  const keepWalletModalOpen = () => {
    clearWalletCloseTimer();
    clearWalletHideTimer();
    setIsWalletModalClosing(false);
    setShowWalletModal(true);
  };

  const closeWalletModal = useCallback(() => {
    clearWalletCloseTimer();

    if (!showWalletModal || isWalletModalClosing) return;

    setIsWalletModalClosing(true);
    clearWalletHideTimer();
    walletHideTimerRef.current = setTimeout(() => {
      setShowWalletModal(false);
      setIsWalletModalClosing(false);
      setWalletButtonRect(null);
      walletHideTimerRef.current = null;
    }, INFO_MODAL_ANIMATION_MS);
  }, [showWalletModal, isWalletModalClosing]);

  const openCreateModal = () => {
    if (showWalletModal) {
      closeWalletModal();
    }
    clearCreateHideTimer();
    setIsCreateModalClosing(false);
    setCreateModalStep("compose");
    setPreviewError("");
    setShowCreateModal(true);
  };

  const closeCreateModal = useCallback(() => {
    if (!showCreateModal || isCreateModalClosing) return;

    setIsCreateModalClosing(true);
    clearCreateHideTimer();
    createHideTimerRef.current = setTimeout(() => {
      setShowCreateModal(false);
      setIsCreateModalClosing(false);
      setCreateModalStep("compose");
      setPreviewError("");
      createHideTimerRef.current = null;
    }, INFO_MODAL_ANIMATION_MS);
  }, [showCreateModal, isCreateModalClosing]);

  const resetCreateModal = useCallback(() => {
    setCreateModalStep("compose");
    setPreviewError("");
    setCreateResetSignal((current) => current + 1);
  }, []);

  const scheduleCloseInfoModal = () => {
    clearInfoCloseTimer();
    infoCloseTimerRef.current = setTimeout(() => {
      closeInfoModal();
    }, 120);
  };

  const scheduleCloseWalletModal = () => {
    clearWalletCloseTimer();
    walletCloseTimerRef.current = setTimeout(() => {
      closeWalletModal();
    }, 120);
  };

  const toggleInfoModal = () => {
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

    closeCreateModal();
  };

  const handleCopyWalletAddress = async () => {
    if (!walletAddress) return;

    try {
      await copyText(walletAddress);
      clearCopiedAddressTimer();
      setCopiedAddress(true);
      copiedAddressTimerRef.current = setTimeout(() => {
        setCopiedAddress(false);
        copiedAddressTimerRef.current = null;
      }, 1200);
    } catch {
      clearCopiedAddressTimer();
      setCopiedAddress(false);
    }
  };

  useEffect(() => {
    return () => {
      clearInfoCloseTimer();
      clearInfoHideTimer();
      clearWalletCloseTimer();
      clearWalletHideTimer();
      clearCopiedAddressTimer();
      clearCreateHideTimer();
    };
  }, []);

  useEffect(() => {
    if (!signer) {
      return;
    }

    let cancelled = false;

    signer.getRecommendedAddress().then((address) => {
      if (!cancelled) {
        setWalletAddress(address);
      }
    }).catch(() => {
      if (!cancelled) {
        setWalletAddress("");
      }
    });

    signer.getBalance().then((balance) => {
      if (!cancelled) {
        setWalletBalance(`${(Number(balance) / 1e8).toFixed(2)} CKB`);
      }
    }).catch(() => {
      if (!cancelled) {
        setWalletBalance("");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [signer]);

  useEffect(() => {
    const handleEscapeClose = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (showWalletModal) {
          closeWalletModal();
        }
        if (showInfoModal) {
          closeInfoModal();
        }
      }
    };

    window.addEventListener("keydown", handleEscapeClose);
    return () => {
      window.removeEventListener("keydown", handleEscapeClose);
    };
  }, [showInfoModal, closeInfoModal, showWalletModal, closeWalletModal]);

  useEffect(() => {
    if (!showInfoModal && !showWalletModal) return;

    const handleViewportChange = () => {
      if (showInfoModal) {
        refreshHeaderInfoButtonRect();
      }
      if (showWalletModal) {
        refreshWalletButtonRect();
      }
    };

    handleViewportChange();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [showInfoModal, showWalletModal, refreshHeaderInfoButtonRect, refreshWalletButtonRect]);

  const shouldHideWalletAction = showCreateModal && !isCreateModalClosing;
  const createTopActionTooltip = createModalStep === "review" ? "Back" : "Close";
  const createTopActionLabel = createModalStep === "review" ? "Back to compose step" : "Close create campaign modal";
  const expectedChain = deriveChainName(client) === "unknown" ? "testnet" : deriveChainName(client);
  const currentChain = signer ? deriveChainName(signer.client) : "unknown";
  const walletAddressDisplay = signer ? (walletAddress || "Loading…") : "Not connected";
  const walletBalanceDisplay = signer ? (walletBalance || "Loading…") : "—";
  const chainIndicatorClassName = currentChain === "unknown"
    ? "wallet-chain-indicator-unknown"
    : currentChain === expectedChain
      ? "wallet-chain-indicator-match"
      : "wallet-chain-indicator-mismatch";

  return (
    <main className="flex flex-col items-center min-h-screen gap-6 p-4 sm:p-8">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="header-info-wrap">
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

          <div className="header-right-actions">
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
                    <X className="campaign-action-icon" size={22} strokeWidth={2} aria-hidden="true" />
                  )}
                </button>
              </div>
            )}

            <div className={`wallet-action-slot ${shouldHideWalletAction ? "wallet-action-slot-hidden" : ""}`}>
              {signer ? (
                <div
                  className="wallet-info-wrap"
                  onMouseEnter={openWalletModalFromHover}
                  onMouseLeave={scheduleCloseWalletModal}
                >
                  <button
                    ref={walletButtonRef}
                    onClick={disconnect}
                    onFocus={openWalletModalFromHover}
                    onBlur={scheduleCloseWalletModal}
                    className="px-4 py-2 rounded-full overflow-hidden font-semibold text-sm btn-wallet w-full sm:w-auto"
                  >
                    Disconnect
                  </button>
                  {showWalletModal && walletButtonRect && (
                    <div
                      className={`wallet-info-modal ${isWalletModalClosing ? "wallet-info-modal-closing" : ""}`}
                      role="dialog"
                      aria-label="Wallet information"
                      onMouseEnter={keepWalletModalOpen}
                      onMouseLeave={scheduleCloseWalletModal}
                      style={{ width: `${Math.max(walletButtonRect.width * 2, 220)}px` }}
                    >
                      <div className="wallet-info-row">
                        <div>
                          <p className="wallet-info-label">Address</p>
                          <p className="wallet-info-value wallet-info-value-mono">{truncateAddress(walletAddressDisplay)}</p>
                        </div>
                        <button
                          type="button"
                          className="wallet-info-icon-btn"
                          onClick={() => void handleCopyWalletAddress()}
                          aria-label="Copy wallet address"
                          title={copiedAddress ? "Copied" : "Copy address"}
                        >
                          <Copy size={15} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </div>

                      <div className="wallet-info-row">
                        <div>
                          <p className="wallet-info-label">Balance</p>
                          <p className="wallet-info-value">{isBalanceVisible ? walletBalanceDisplay : "••••••"}</p>
                        </div>
                        <button
                          type="button"
                          className="wallet-info-icon-btn"
                          onClick={() => setIsBalanceVisible((current) => !current)}
                          aria-label={isBalanceVisible ? "Hide balance" : "Show balance"}
                          title={isBalanceVisible ? "Hide balance" : "Show balance"}
                        >
                          {isBalanceVisible ? (
                            <EyeOff size={15} strokeWidth={2} aria-hidden="true" />
                          ) : (
                            <Eye size={15} strokeWidth={2} aria-hidden="true" />
                          )}
                        </button>
                      </div>

                      <div className="wallet-info-row wallet-info-row-chain">
                        <div>
                          <p className="wallet-info-label">Chain</p>
                          <p className="wallet-info-value">Current: {chainLabel(currentChain)}</p>
                          <p className="wallet-info-subvalue">Expected: {chainLabel(expectedChain)}</p>
                        </div>
                        <span className={`wallet-chain-indicator ${chainIndicatorClassName}`} aria-hidden="true" />
                      </div>

                      <button type="button" className="wallet-info-menu-item">
                        <Settings2 size={16} strokeWidth={2} aria-hidden="true" />
                        <span>Introspect</span>
                      </button>
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

          {showInfoModal && (
            <div
              className={`header-info-modal ${isInfoModalClosing ? "header-info-modal-closing" : ""}`}
              role="dialog"
              aria-label="Freight information modal"
              onMouseEnter={keepInfoModalOpen}
              onMouseLeave={scheduleCloseInfoModal}
            >
              <h1 className="text-2xl sm:text-3xl font-bold">FreightOnNervos</h1>
              <p className="text-xs text-gray-400 font-mono break-all mt-2">
                Contract:{" "}
                <a
                  href={`https://pudge.explorer.nervos.org/transaction/${FREIGHT_CONTRACT.outPoint.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {FREIGHT_CONTRACT.outPoint.txHash.slice(0, 22)}…
                </a>
              </p>
              {showCreateModal && (
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
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {signer && (
          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
            <MountablesPanel />
          </div>
        )}

        <CampaignListHeader client={client} />
      </div>

      {showInfoModal && (
        <button
          type="button"
          className={`header-info-backdrop ${isInfoModalClosing ? "header-info-backdrop-closing" : ""}`}
          aria-label="Close Freight information modal"
          onClick={closeInfoModal}
          style={{ pointerEvents: infoModalInteraction === "click" ? "auto" : "none" }}
        />
      )}

      {showInfoModal && activeInfoButtonRect && (
        <button
          type="button"
          className="header-info-btn header-info-btn-floating"
          aria-label="Open Freight information"
          onClick={(event) => {
            event.stopPropagation();
            toggleInfoModal();
          }}
          onMouseEnter={keepInfoModalOpen}
          onMouseLeave={scheduleCloseInfoModal}
          onFocus={keepInfoModalOpen}
          onBlur={scheduleCloseInfoModal}
          style={{
            left: `${activeInfoButtonRect.left}px`,
            top: `${activeInfoButtonRect.top}px`,
            width: `${activeInfoButtonRect.width}px`,
            height: `${activeInfoButtonRect.height}px`,
          }}
        >
          <span className="header-info-inner-ring" aria-hidden="true" />
          <span className="header-info-glyph" aria-hidden="true">i</span>
        </button>
      )}

      {showCreateModal && (
        <button
          type="button"
          className={`create-campaign-backdrop ${isCreateModalClosing ? "create-campaign-backdrop-closing" : ""}`}
          aria-label="Close create campaign modal"
          onClick={closeCreateModal}
        />
      )}

      {showCreateModal && (
        <div
          className={`create-campaign-modal ${isCreateModalClosing ? "create-campaign-modal-closing" : ""}`}
          role="dialog"
          aria-label="Create campaign modal"
          aria-modal="true"
        >
          <CreateCampaignModalContent
            mode="modal"
            onRequestClose={closeCreateModal}
            resetSignal={createResetSignal}
            stepBackSignal={createStepBackSignal}
            onStepChange={setCreateModalStep}
            onConstraintStatusChange={setConstraintStatus}
            onPreviewErrorChange={setPreviewError}
          />
        </div>
      )}

      <button
        type="button"
        aria-label="Open create campaign modal"
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
      <div className="retro-marquee-viewport">
        <div className="retro-marquee-track">
          <span>{marqueeText}</span>
          <span aria-hidden="true">{marqueeText}</span>
        </div>
      </div>
    </div>
  );
}

function CampaignListHeader({ client }: { client: ccc.Client }) {
  const [campaigns, setCampaigns] = useState<CampaignCell[]>([]);
  const [recordsByTxHash, setRecordsByTxHash] = useState<Record<string, CampaignRecord>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const loadCampaigns = useCallback(() => {
    setLoading(true);
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
        const nextRecordsByTxHash: Record<string, CampaignRecord> = {};

        for (const record of records) {
          const key = normalizeHash(record.txHash);
          if (key && !nextRecordsByTxHash[key]) {
            nextRecordsByTxHash[key] = record;
          }
        }

        setCampaigns(chainCampaigns);
        setRecordsByTxHash(nextRecordsByTxHash);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => {
        setLoading(false);
        setIsRefreshing(false);
      });
  }, [client]);

  useEffect(() => {
    const loadTimer = setTimeout(() => {
      loadCampaigns();
    }, 0);

    return () => {
      clearTimeout(loadTimer);
    };
  }, [loadCampaigns]);

  useEffect(() => {
    if (isSearchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchOpen]);

  const handleRefresh = () => {
    loadCampaigns();
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

  const mergedCampaigns = useMemo<MergedCampaign[]>(() => {
    return campaigns.map((campaign) => ({
      campaign,
      record: recordsByTxHash[normalizeHash(campaign.outPoint.txHash)] ?? null,
      displayStatus: deriveDisplayStatus(campaign),
    }));
  }, [campaigns, recordsByTxHash]);

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
        <h2 className="text-lg sm:text-xl font-semibold">Freights</h2>
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="campaign-action-btn"
            data-tooltip="Refresh campaigns"
          >
            <RefreshCw className={`campaign-action-icon ${isRefreshing ? "refreshing" : ""}`} size={24} strokeWidth={2} aria-hidden="true" />
          </button>
          <div className={`campaign-search-wrapper ${isSearchOpen ? "active" : ""}`}>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search campaigns..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="campaign-search-input"
            />
          </div>
          <button
            onClick={handleSearchClick}
            className="campaign-action-btn"
            data-tooltip="Search campaigns"
          >
            <Search className="campaign-action-icon" size={24} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>

      <CampaignList campaigns={filteredCampaigns} loading={loading} error={error} />
    </>
  );
}

function CampaignList({ campaigns, loading, error }: { campaigns: MergedCampaign[]; loading: boolean; error: string }) {
  const signer = ccc.useSigner();

  if (loading) {
    return <p className="text-sm text-gray-400">Loading campaigns…</p>;
  }

  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
  }

  if (campaigns.length === 0) {
    return <p className="text-sm text-gray-400">No campaigns found on testnet yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {campaigns.map(({ campaign, record, displayStatus }) => (
        <CampaignCard
          key={`${campaign.outPoint.txHash}:${campaign.outPoint.index}`}
          campaign={campaign}
          record={record}
          displayStatus={displayStatus}
          signer={signer ?? null}
        />
      ))}
    </div>
  );
}

function CampaignCard({
  campaign: c,
  record,
  displayStatus,
  signer,
}: {
  campaign: CampaignCell;
  record: CampaignRecord | null;
  displayStatus: CampaignStatus;
  signer: ccc.Signer | null;
}) {
  const { data, outPoint } = c;
  const shortHash = outPoint.txHash.slice(0, 10) + "…";
  const createdAtDate = new Date(Number(data.createdAt)).toLocaleDateString();
  const maxCkb = formatCkbAmount(data.maximumAmount);
  const depositedCkb = formatCkbAmount(data.currentDeposits);
  const ticketPriceCkb = Number(data.auxAmount) > 0 ? formatCkbAmount(data.auxAmount) : null;
  const onchainSummary = decodeSummary(data.summary);
  const creatorAddress = record?.creatorAddress || decodeCreatedByAddress(c);
  const creatorHandle = record?.creatorHandle || buildDefaultHandle(creatorAddress);
  const displayTitle = record?.title?.trim() || onchainSummary;
  const displayDescription = record?.description?.trim() || onchainSummary;
  const mentions = record?.socialMetadata?.mentions ?? [];

  const [likes, setLikes] = useState(record?.socialMetadata?.likeCount ?? 0);
  const [bookmarks, setBookmarks] = useState(record?.socialMetadata?.bookmarkCount ?? 0);
  const [comments, setComments] = useState(Array.isArray(record?.socialMetadata?.comments) ? record.socialMetadata.comments.length : 0);
  const [reshares, setReshares] = useState(record?.socialMetadata?.reshareCount ?? 0);
  const [userLiked, setUserLiked] = useState(false);
  const [userBookmarked, setUserBookmarked] = useState(false);
  const [userCommented, setUserCommented] = useState(false);
  const [userReshared, setUserReshared] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "error">("idle");

  const [showDepositModal, setShowDepositModal] = useState(false);
  const [depositAmount, setDepositAmount] = useState("");
  const [isDepositing, setIsDepositing] = useState(false);

  const isConnected = !!signer;

  const handleLike = () => {
    if (!isConnected) return;
    setUserLiked(!userLiked);
    setLikes((prev) => (userLiked ? prev - 1 : prev + 1));
  };

  const handleBookmark = () => {
    if (!isConnected) return;
    setUserBookmarked(!userBookmarked);
    setBookmarks((prev) => (userBookmarked ? prev - 1 : prev + 1));
  };

  const handleComment = () => {
    if (!isConnected) return;
    setUserCommented(!userCommented);
    setComments((prev) => (userCommented ? prev - 1 : prev + 1));
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
    if (!isConnected) return;
    setShowDepositModal(true);
  };

  const handleDepositSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signer || !depositAmount) return;

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

  return (
    <div className="flex flex-col gap-0">
      <div className="border border-gray-200 rounded-lg p-4 flex flex-col gap-4">
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

        <div className="flex flex-wrap gap-2 text-xs text-gray-500">
          <span className="font-medium text-gray-800">{TYPE_LABELS[data.campaignType] ?? data.campaignType}</span>
          <span>Created {createdAtDate}</span>
          <span>Start delay {formatDurationLabel(Number(data.startDurationSecs))}</span>
          <span>Duration {formatDurationLabel(Number(data.taskDurationSecs))}</span>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-xl font-semibold leading-tight text-gray-900">{displayTitle}</h3>
          <p className="text-sm leading-6 text-gray-700 whitespace-pre-wrap break-words">{displayDescription}</p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 rounded bg-gray-900 text-white font-semibold">#{TYPE_TAGS[data.campaignType] ?? data.campaignType}</span>
          {mentions.map((mention) => (
            <span key={mention} className="px-2 py-1 rounded border border-gray-300 text-gray-600">@{mention}</span>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-600">
          <div className="rounded border border-gray-200 px-3 py-2">
            <div className="font-semibold text-gray-900">Max deposit</div>
            <div>{maxCkb} CKB</div>
          </div>
          <div className="rounded border border-gray-200 px-3 py-2">
            <div className="font-semibold text-gray-900">Current deposit</div>
            <div>{depositedCkb} CKB</div>
          </div>
          <div className="rounded border border-gray-200 px-3 py-2">
            <div className="font-semibold text-gray-900">Summary</div>
            <div>{record?.summaryDraft || onchainSummary}</div>
          </div>
          <div className="rounded border border-gray-200 px-3 py-2">
            <div className="font-semibold text-gray-900">Ticket price</div>
            <div>{ticketPriceCkb ? `${ticketPriceCkb} CKB` : "—"}</div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
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
          {data.rewardCount > 0n && (
            <span className="text-xs text-gray-500">
              Reward count: <strong className="text-gray-800">{String(data.rewardCount)}</strong>
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2 pb-3 text-xs">
        <button
          onClick={handleLike}
          className={`campaign-action-btn ${userLiked ? "campaign-action-active" : ""} ${!isConnected ? "campaign-action-disabled" : ""}`}
          data-tooltip={!isConnected ? "Connect wallet to like" : "Like"}
        >
          <Heart className="campaign-action-icon" size={16} strokeWidth={2} aria-hidden="true" />
          <span className="campaign-action-count">{likes}</span>
        </button>

        <button
          onClick={handleBookmark}
          className={`campaign-action-btn action-bookmark ${userBookmarked ? "campaign-action-active" : ""} ${!isConnected ? "campaign-action-disabled" : ""}`}
          data-tooltip={!isConnected ? "Connect wallet to bookmark" : "Bookmark"}
        >
          <Bookmark className="campaign-action-icon" size={16} strokeWidth={2} aria-hidden="true" />
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

        <button
          onClick={handleDepositClick}
          className={`campaign-action-btn ml-auto ${!isConnected ? "campaign-action-disabled" : ""}`}
          data-tooltip={!isConnected ? "Connect wallet to deposit" : "Deposit CKB"}
        >
          <Coins className="campaign-action-icon" size={16} strokeWidth={2} aria-hidden="true" />
          <span className="campaign-action-count font-mono">{depositedCkb} / {maxCkb} CKB</span>
        </button>
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
                  disabled={isDepositing}
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
                  disabled={isDepositing || !depositAmount}
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
