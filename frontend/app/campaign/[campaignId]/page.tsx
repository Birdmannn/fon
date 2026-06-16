"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { Copy } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import CampaignCardSurface from "@/app/_components/CampaignCardSurface";
import CampaignCommentsPanel from "@/app/_components/CampaignCommentsPanel";
import FreightInfoModal from "@/app/_components/FreightInfoModal";
import { CampaignStatus } from "@/lib/contract";
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

function decodeCreatedByAddress(campaign: CampaignCell) {
  return bytesToHex(campaign.data.createdBy);
}

function buildDefaultHandle(addressHex: string) {
  const normalized = addressHex.toLowerCase().replace(/^0x/, "");
  return `freight${normalized.slice(-20)}.ckb`;
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

function formatCkbAmount(value: bigint) {
  return (Number(value) / 1e8).toFixed(2);
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

function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return Promise.reject(new Error("Clipboard API unavailable"));
}

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

  const INFO_MODAL_ANIMATION_MS = 620;
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [isInfoModalClosing, setIsInfoModalClosing] = useState(false);
  const [showWalletInfoModal, setShowWalletInfoModal] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [walletInfoError, setWalletInfoError] = useState("");
  const [walletInfoLoading, setWalletInfoLoading] = useState(false);
  const [walletCopyFeedback, setWalletCopyFeedback] = useState<"idle" | "copied" | "error">("idle");
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

  const toggleInfoModal = () => {
    if (showInfoModal && !isInfoModalClosing) {
      closeInfoModal();
      return;
    }

    openInfoModalFromHover();
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

  const walletChainLabel = useMemo(() => deriveChainLabel(client), [client]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

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
    })();

    return () => {
      cancelled = true;
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
      return (
        <div className="campaign-detail-content">
          <section className="campaign-detail-post-column">
            <div className="campaign-detail-skeleton-card animate-pulse">
              <span className="campaign-detail-skeleton-line campaign-detail-skeleton-line-short" />
              <span className="campaign-detail-skeleton-line campaign-detail-skeleton-line-medium" />
              <span className="campaign-detail-skeleton-line campaign-detail-skeleton-line-full" />
              <span className="campaign-detail-skeleton-line campaign-detail-skeleton-line-full" />
              <span className="campaign-detail-skeleton-line campaign-detail-skeleton-line-medium" />
            </div>
          </section>
          <section className="campaign-detail-comments-column">
            <div className="campaign-detail-comments-card animate-pulse">
              <span className="campaign-detail-skeleton-line campaign-detail-skeleton-line-short" />
              <span className="campaign-detail-skeleton-line campaign-detail-skeleton-line-full" />
              <span className="campaign-detail-skeleton-line campaign-detail-skeleton-line-medium" />
              <span className="campaign-detail-skeleton-line campaign-detail-skeleton-line-full" />
            </div>
          </section>
        </div>
      );
    }

    if (error) {
      return <p className="text-sm text-gray-400">{error}</p>;
    }

    if (!selectedCampaign) {
      return <p className="text-sm text-gray-400">Campaign not found.</p>;
    }

    const displayStatus = deriveDisplayStatus(selectedCampaign, nowMs);
    const creatorAddress = selectedRecord?.creatorAddress ?? decodeCreatedByAddress(selectedCampaign);
    const creatorHandle = selectedRecord?.creatorHandle ?? buildDefaultHandle(creatorAddress);
    const summary = selectedRecord?.summaryDraft ?? decodeSummary(selectedCampaign.data.summary);
    const title = selectedRecord?.title?.trim() || summary;

    return (
      <>
        <div className="campaign-detail-header">
          <Link href="/" className="campaign-detail-back-link">← Back to freights</Link>
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
      <div className="campaign-detail-shell">
        <div className="fixed top-8 left-4 right-4 z-[70] mx-auto w-full max-w-2xl flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="header-info-wrap">
            <div onMouseEnter={openInfoModalFromHover} onMouseLeave={scheduleCloseInfoModal}>
              <button
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
            <div className="wallet-action-slot">
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
