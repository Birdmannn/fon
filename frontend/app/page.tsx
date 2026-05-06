"use client";

import {
  ArrowLeft,
  Bookmark,
  CheckCircle,
  Coins,
  Heart,
  Info,
  MessageSquare,
  Plus,
  RefreshCw,
  Repeat2,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { ccc } from "@ckb-ccc/connector-react";
import { useEffect, useState, useRef, useCallback } from "react";
import CreateCampaignModalContent, { CreateConstraintStatus, CreateModalStep } from "@/app/create/_components/CreateCampaignModalContent";
import { FREIGHT_CONTRACT } from "@/lib/contract";
import { fetchCampaigns, sendDeposit, CampaignCell } from "@/lib/transactions";

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

export default function Home() {
  const { open, disconnect, client } = ccc.useCcc();
  const signer = ccc.useSigner();
  const INFO_MODAL_ANIMATION_MS = 620;
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [isInfoModalClosing, setIsInfoModalClosing] = useState(false);
  const [infoModalInteraction, setInfoModalInteraction] = useState<"hover" | "click">("hover");
  const [activeInfoButtonRect, setActiveInfoButtonRect] = useState<DOMRect | null>(null);
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
  const createHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerInfoButtonRef = useRef<HTMLButtonElement>(null);

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

  const refreshHeaderInfoButtonRect = useCallback(() => {
    const button = headerInfoButtonRef.current;
    if (!button) return;

    setActiveInfoButtonRect(button.getBoundingClientRect());
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

  const openCreateModal = () => {
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
    if (infoModalInteraction === "click") {
      return;
    }

    clearInfoCloseTimer();
    infoCloseTimerRef.current = setTimeout(() => {
      closeInfoModal();
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

  useEffect(() => {
    return () => {
      clearInfoCloseTimer();
      clearInfoHideTimer();
      clearCreateHideTimer();
    };
  }, []);

  useEffect(() => {
    if (!showInfoModal) return;

    const handleEscapeClose = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeInfoModal();
      }
    };

    window.addEventListener("keydown", handleEscapeClose);
    return () => {
      window.removeEventListener("keydown", handleEscapeClose);
    };
  }, [showInfoModal, closeInfoModal]);

  useEffect(() => {
    if (!showInfoModal) return;

    refreshHeaderInfoButtonRect();

    const handleViewportChange = () => {
      refreshHeaderInfoButtonRect();
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [showInfoModal, refreshHeaderInfoButtonRect]);

  const shouldHideWalletAction = showCreateModal && !isCreateModalClosing;
  const createTopActionTooltip = createModalStep === "review" ? "Back" : "Close";
  const createTopActionLabel = createModalStep === "review" ? "Back to compose step" : "Close create campaign modal";

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
                    <ArrowLeft className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <X className="campaign-action-icon" size={22} strokeWidth={2} aria-hidden="true" />
                  )}
                </button>
              </div>
            )}

            <div className={`wallet-action-slot ${shouldHideWalletAction ? "wallet-action-slot-hidden" : ""}`}>
              {signer ? (
                <button
                  onClick={disconnect}
                  className="px-4 py-2 rounded-full overflow-hidden font-semibold text-sm btn-wallet w-full sm:w-auto"
                >
                  Disconnect
                </button>
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
            <ConnectedInfo signer={signer} />
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
          {/* <Info size={16} strokeWidth={2.2} aria-hidden="true" /> */}
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

function ConnectedInfo({ signer }: { signer: ccc.Signer }) {
  const [address, setAddress] = useState<string>("");
  const [balance, setBalance] = useState<string>("");

  useEffect(() => {
    signer.getRecommendedAddress().then(setAddress);
    signer
      .getBalance()
      .then((b) => setBalance((Number(b) / 1e8).toFixed(2) + " CKB"));
  }, [signer]);

  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span className="font-mono text-xs text-gray-500 break-all">{address}</span>
      <span className="font-semibold">{balance || "Loading…"}</span>
    </div>
  );
}

function CampaignListHeader({ client }: { client: ccc.Client }) {
  const [campaigns, setCampaigns] = useState<CampaignCell[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const loadCampaigns = useCallback(() => {
    setLoading(true);
    setIsRefreshing(true);
    fetchCampaigns(client)
      .then(setCampaigns)
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
    if (campaigns.length > 0) {
      loadCampaigns();
    }
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

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg sm:text-xl font-semibold">Campaigns</h2>
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

      <CampaignList campaigns={campaigns} loading={loading} error={error} client={client} />
    </>
  );
}

function CampaignList({ campaigns, loading, error }: { campaigns: CampaignCell[]; loading: boolean; error: string; client: ccc.Client }) {
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
      {campaigns.map((c) => (
        <CampaignCard key={`${c.outPoint.txHash}:${c.outPoint.index}`} campaign={c} signer={signer ?? null} />
      ))}
    </div>
  );
}

const STATUS_LABELS = ["Created", "Active", "Completed", "Cancelled"];
const TYPE_LABELS = ["Simple Task", "Funded Task", "Crowdfunding", "Timed Challenge"];

function CampaignCard({ campaign: c, signer }: { campaign: CampaignCell; signer: ccc.Signer | null }) {
  const { data, outPoint } = c;
  const shortHash = outPoint.txHash.slice(0, 10) + "…";
  const createdAtDate = new Date(Number(data.createdAt)).toLocaleDateString();
  const maxCkb = (Number(data.maximumAmount) / 1e8).toFixed(2);
  const depositedCkb = (Number(data.currentDeposits) / 1e8).toFixed(2);

  const [likes, setLikes] = useState(0);
  const [bookmarks, setBookmarks] = useState(0);
  const [comments, setComments] = useState(0);
  const [reshares, setReshares] = useState(0);
  const [userLiked, setUserLiked] = useState(false);
  const [userBookmarked, setUserBookmarked] = useState(false);
  const [userCommented, setUserCommented] = useState(false);
  const [userReshared, setUserReshared] = useState(false);

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
          <span className={`status-indicator status-${["created", "active", "completed", "cancelled"][data.status] || "created"}`} title={STATUS_LABELS[data.status] ?? data.status} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 text-sm">
          <span className="font-medium">{TYPE_LABELS[data.campaignType] ?? data.campaignType}</span>
          <span className="text-gray-400 text-xs">Created {createdAtDate}</span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-4 text-xs text-gray-500">
          {data.rewardCount > 0n && (
            <span>
              Reward count:{" "}
              <strong className="text-gray-800">{String(data.rewardCount)}</strong>
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
          <Repeat2 className="campaign-action-icon" size={16} strokeWidth={2} aria-hidden="true" />
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
