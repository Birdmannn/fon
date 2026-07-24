"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { Copy } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import CampaignCardSurface from "@/app/_components/CampaignCardSurface";
import CampaignCommentsPanel from "@/app/_components/CampaignCommentsPanel";
import FreightInfoModal from "@/app/_components/FreightInfoModal";
import ThreeDotLoader from "@/app/_components/ThreeDotLoader";
import { buildDefaultHandle, deriveDisplayStatus, formatCkbAmount } from "@/lib/campaignDisplay";
import { bytesToHex, decodeSummary } from "@/lib/encoding";
import { fetchCampaigns, type CampaignCell } from "@/lib/transactions";
import {
  buildCampaignRecordIndexes,
  findCampaignRecord,
  getCampaignStableId,
  normalizeHash,
  type CampaignRecordIndexes,
} from "@/lib/campaignIdentity";

type CampaignRecord = {
  _id?: string;
  title?: string;
  description?: string;
  campaignId?: string | null;
  createdByHash?: string | null;
  chainCreatedAt?: string | null;
  creatorAddress?: string | null;
  creatorHandle?: string | null;
  campaignType?: number;
  summaryDraft?: string;
  socialMetadata?: {
    mentions?: string[];
    comments?: Array<{
      text: string;
      creatorAddress?: string | null;
      creatorHandle?: string | null;
      createdAt?: string;
    }>;
  };
  status?: "draft" | "published" | "publish_failed";
  txHash?: string | null;
};

function decodeCreatedByAddress(campaign: CampaignCell) {
  return bytesToHex(campaign.data.createdBy);
}

function splitCampaignId(campaignId: string) {
  const normalizedCampaignId = normalizeHash(campaignId);
  if (normalizedCampaignId.includes(":")) {
    return { campaignId: normalizedCampaignId };
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

  return { txHash, index, campaignId: null };
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

export default function CampaignDetailPage() {
  const { open, disconnect, client } = ccc.useCcc();
  const signer = ccc.useSigner();
  const params = useParams<{ campaignId: string }>();
  const campaignRef = splitCampaignId(params.campaignId);
  const [campaigns, setCampaigns] = useState<CampaignCell[]>([]);
  const [recordIndexes, setRecordIndexes] = useState<CampaignRecordIndexes<CampaignRecord>>(() => ({
    byCampaignId: {},
    byTxHash: {},
    byLegacyKey: {},
  }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [shellWidthClass, setShellWidthClass] = useState("campaign-shell-width");

  const INFO_MODAL_ANIMATION_MS = 620;
  const returnToFeedTimerRef = useRef<number | null>(null);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [isInfoModalClosing, setIsInfoModalClosing] = useState(false);
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

  const closeInfoModal = useCallback(() => {
    clearInfoCloseTimer();
    if (!showInfoModal || isInfoModalClosing) {
      return;
    }

    setIsInfoModalClosing(true);
    clearInfoHideTimer();
    infoHideTimerRef.current = setTimeout(() => {
      setShowInfoModal(false);
      setIsInfoModalClosing(false);
      infoHideTimerRef.current = null;
    }, INFO_MODAL_ANIMATION_MS);
  }, [showInfoModal, isInfoModalClosing]);

  const openInfoModalFromHover = () => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  };

  const keepInfoModalOpen = () => {
    clearInfoCloseTimer();
    clearInfoHideTimer();
    setIsInfoModalClosing(false);
    setShowInfoModal(true);
  };

  const scheduleCloseInfoModal = () => {
    clearInfoCloseTimer();
    infoCloseTimerRef.current = setTimeout(() => {
      closeInfoModal();
    }, 120);
  };

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

    void (async () => {
      try {
        setLoading(true);
        setError("");

        const [chainCampaigns, recordsResponse] = await Promise.all([
          fetchCampaigns(client),
          fetch("/api/campaign-records", { cache: "no-store" }),
        ]);

        const recordsPayload = await recordsResponse.json().catch(() => null);
        if (!recordsResponse.ok) {
          throw new Error(recordsPayload?.error ?? "Failed to fetch campaign records");
        }

        const records = Array.isArray(recordsPayload?.records) ? (recordsPayload.records as CampaignRecord[]) : [];
        const nextRecordIndexes = buildCampaignRecordIndexes(records);

        if (!cancelled) {
          setCampaigns(chainCampaigns);
          setRecordIndexes(nextRecordIndexes);
        }
      } catch (loadError) {
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
  }, [client]);

  const selectedCampaign = useMemo(() => {
    if (!campaignRef) {
      return null;
    }

    if (campaignRef.campaignId) {
      return campaigns.find((campaign) => getCampaignStableId(campaign) === campaignRef.campaignId) ?? null;
    }

    return campaigns.find((campaign) => (
      normalizeHash(campaign.outPoint.txHash) === normalizeHash(campaignRef.txHash)
      && campaign.outPoint.index === campaignRef.index
    )) ?? null;
  }, [campaignRef, campaigns]);

  const selectedRecord = useMemo(() => {
    if (!selectedCampaign) {
      return null;
    }

    return findCampaignRecord(recordIndexes, selectedCampaign);
  }, [recordIndexes, selectedCampaign]);

  const comments = useMemo(() => (
    Array.isArray(selectedRecord?.socialMetadata?.comments)
      ? selectedRecord.socialMetadata.comments.filter((value) => !!value && typeof value.text === "string")
      : []
  ), [selectedRecord?.socialMetadata?.comments]);

  const headerBody = (
    <div className="create-info-constraints-copy">
      <p className="mt-3 create-review-section-label text-gray-900">Freight details</p>
      <p className="create-info-constraint-item text-gray-500">
        <span>Browse a freight in full, then jump back to the feed when you are done.</span>
      </p>
      <p className="create-info-constraint-item text-gray-500">
        <span>Use the comment section to follow the conversation once the shared composer is wired here.</span>
      </p>
    </div>
  );

  const detailContent = (() => {
    if (loading) {
      return <ThreeDotLoader className="campaign-detail-status" label="Loading freight details" />;
    }

    if (error) {
      return (
        <div className="campaign-detail-status">
          <p className="text-sm text-gray-400">{error}</p>
        </div>
      );
    }

    if (!selectedCampaign) {
      return (
        <div className="campaign-detail-status">
          <p className="text-sm text-gray-400">Campaign not found.</p>
        </div>
      );
    }

    const displayStatus = deriveDisplayStatus(selectedCampaign, nowMs);
    const creatorAddress = selectedRecord?.creatorAddress ?? decodeCreatedByAddress(selectedCampaign);
    const creatorHandle = selectedRecord?.creatorHandle ?? buildDefaultHandle(creatorAddress);
    const summary = selectedRecord?.summaryDraft ?? decodeSummary(selectedCampaign.data.summary);
    const title = selectedRecord?.title?.trim() || summary;

    return (
      <>
        <div className="campaign-detail-header">
          <Link href="/" className="campaign-detail-back-link" onClick={handleReturnToFeed}>← Back to freights</Link>
          <div className="campaign-detail-header-copy">
            <p className="campaign-detail-eyebrow">Campaign detail</p>
            <h1 className="campaign-detail-heading">{title}</h1>
            <p className="campaign-detail-subtitle">{creatorHandle}</p>
          </div>
        </div>

        <div className="campaign-detail-content">
          <section className="campaign-detail-post-column">
            <CampaignCardSurface
              campaign={selectedCampaign}
              record={selectedRecord}
              displayStatus={displayStatus}
              nowMs={nowMs}
              variant="detail"
            />
          </section>

          <section className="campaign-detail-comments-column">
            <CampaignCommentsPanel comments={comments} fallbackAddress={creatorAddress} />
          </section>
        </div>
      </>
    );
  })();

  return (
    <main className="campaign-detail-page">
      <div className={`campaign-detail-shell ${shellWidthClass}`.trim()}>
        <div className={`campaign-shell-header ${shellWidthClass} fixed top-8 left-4 right-4 z-[70] mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`.trim()}>
          <div className="header-info-wrap">
            <div onMouseEnter={openInfoModalFromHover} onMouseLeave={scheduleCloseInfoModal}>
              <button
                type="button"
                className="header-info-btn"
                aria-label="Open Freight information"
                onClick={() => handleReturnToFeed()}
                onFocus={openInfoModalFromHover}
                onBlur={scheduleCloseInfoModal}
              >
                <span className="header-info-inner-ring" aria-hidden="true" />
                <span className="header-info-glyph" aria-hidden="true">i</span>
              </button>
            </div>
          </div>

          <div className="header-right-actions">
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
            body={headerBody}
            backdropAriaLabel="Close Freight information modal"
            backdropInteractive
            onRequestClose={closeInfoModal}
            onKeepOpen={keepInfoModalOpen}
            onScheduleClose={scheduleCloseInfoModal}
          />
        </div>

        <div className="campaign-detail-content-shell">
          {detailContent}
        </div>
      </div>
    </main>
  );
}
