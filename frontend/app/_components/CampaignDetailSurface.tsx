"use client";

import Link from "next/link";
import { Copy, Scroll, Ticket } from "lucide-react";
import { useMemo, useState } from "react";

import type { CampaignRecord } from "@/app/_types/campaignRecords";
import {
  buildDefaultHandle,
  decodeCreatedByAddress,
  deriveDisplayStatus,
  deriveRaffleSettlementUiState,
  formatCkbAmount,
} from "@/lib/campaignDisplay";
import { CampaignStatus } from "@/lib/contract";
import { decodeSummary } from "@/lib/encoding";
import type { CampaignCell } from "@/lib/transactions";

const STATUS_LABELS = ["Created", "Active", "Completed", "Cancelled"];
const TYPE_LABELS = ["Simple Task", "FundedTask", "Crowdfunding", "Timed Challenge", "Raffle"];
const CAMPAIGN_CARD_PREVIEW_MAX_CHARS = 1200;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type CampaignCountdownTone = "good" | "warn" | "danger" | "ended";
type CampaignCountdownPhase = "start" | "duration" | "ended";

type CampaignDetailSurfaceProps = {
  campaign: CampaignCell | null;
  chainSyncError?: string;
  isChainSyncing?: boolean;
  nowMs: number;
  record: CampaignRecord;
};

function formatCountdownSegment(value: number) {
  return String(Math.max(0, value)).padStart(2, "0");
}

function sanitizeCampaignDescription(text: string) {
  return text
    .replace(/(^|\s)#(?:simpletask|fundedtask|crowdfunding|timedchallenge|raffle|mounted)\b/gi, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
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

function parseNonNegativeNumber(value: string | null | undefined) {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function buildRecordCountdown(record: CampaignRecord, nowMs: number) {
  const createdAtMs = Number(record.chainCreatedAt ?? "");
  const startDelayHours = parseNonNegativeNumber(record.argsDraft?.taskStartDelayHours);
  const durationHours = parseNonNegativeNumber(record.argsDraft?.taskDurationHours);

  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0 || startDelayHours === null || durationHours === null) {
    return {
      text: "--",
      tone: "ended" as CampaignCountdownTone,
      phase: "ended" as CampaignCountdownPhase,
    };
  }

  const startDelayMs = startDelayHours * 3600_000;
  const durationMs = durationHours * 3600_000;
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

function deriveRecordDisplayStatus(record: CampaignRecord, nowMs: number) {
  const countdown = buildRecordCountdown(record, nowMs);
  if (countdown.phase === "start") {
    return CampaignStatus.Created;
  }

  if (countdown.phase === "duration") {
    return CampaignStatus.Active;
  }

  return CampaignStatus.Completed;
}

function formatRecordCkbAmount(value: string | null | undefined) {
  const parsed = parseNonNegativeNumber(value);
  return parsed === null ? null : parsed.toFixed(2);
}

async function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  throw new Error("Clipboard API unavailable");
}

export default function CampaignDetailSurface({
  campaign,
  chainSyncError = "",
  isChainSyncing = false,
  nowMs,
  record,
}: CampaignDetailSurfaceProps) {
  const createdByFallback = record.createdByHash?.trim() || (campaign ? decodeCreatedByAddress(campaign) : ZERO_ADDRESS);
  const creatorAddress = record.creatorAddress?.trim() || createdByFallback;
  const creatorHandle = record.creatorHandle?.trim() || buildDefaultHandle(creatorAddress);
  const summary = record.summaryDraft?.trim() || (campaign ? decodeSummary(campaign.data.summary) : "Untitled freight");
  const displayTitle = record.title?.trim() || summary;
  const displayDescription = sanitizeCampaignDescription(record.description?.trim() || summary);
  const collapsedDescription = useMemo(
    () => truncateCampaignDescription(displayDescription, CAMPAIGN_CARD_PREVIEW_MAX_CHARS),
    [displayDescription]
  );
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(true);
  const shouldShowReadMore = collapsedDescription.truncated;
  const visibleDescription = isDescriptionExpanded ? displayDescription : collapsedDescription.text;
  const descriptionLines = visibleDescription.length > 0 ? visibleDescription.split("\n") : [];
  const displayStatus = campaign ? deriveDisplayStatus(campaign, nowMs) : deriveRecordDisplayStatus(record, nowMs);
  const countdown = campaign ? buildRecordCountdown({
    ...record,
    chainCreatedAt: String(campaign.data.createdAt),
    argsDraft: {
      ...record.argsDraft,
      taskStartDelayHours: String(Number(campaign.data.startDurationSecs) / 3600),
      taskDurationHours: String(Number(campaign.data.taskDurationSecs) / 3600),
    },
  }, nowMs) : buildRecordCountdown(record, nowMs);
  const countdownTitle = countdown.phase === "start" ? "Starts in" : countdown.phase === "duration" ? "Ends in" : "Ended";
  const countdownClassName = `campaign-card-countdown campaign-card-countdown-${countdown.tone}`;
  const campaignType = campaign?.data.campaignType ?? record.campaignType ?? 0;
  const isRaffleCampaign = campaignType === 4;
  const ticketPriceLabel = campaign
    ? (campaign.data.auxAmount > 0n ? formatCkbAmount(campaign.data.auxAmount) : null)
    : formatRecordCkbAmount(record.argsDraft?.auxAmountCkb);
  const rewardCountValue = campaign ? Number(campaign.data.rewardCount) : Number.parseInt(record.argsDraft?.rewardCount ?? "0", 10);
  const shouldGlowSettlement = campaign
    ? deriveRaffleSettlementUiState({
      campaign,
      displayStatus,
      settlementTxHash: record.settlementTxHash ?? null,
      soldTicketCount: record.soldTicketCount ?? null,
    }).shouldGlowSettlement
    : false;
  const txHash = campaign?.outPoint.txHash ?? record.txHash ?? "";
  const shortHash = txHash ? `${txHash.slice(0, 10)}…` : "Unavailable";
  const createdAtLabelSource = campaign ? String(campaign.data.createdAt) : record.chainCreatedAt;
  const createdAtDate = createdAtLabelSource ? new Date(Number(createdAtLabelSource)).toLocaleDateString() : "Unknown";
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "error">("idle");

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

  return (
    <div className="campaign-card-surface campaign-card-surface-detail p-4 flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <button
            type="button"
            onClick={() => void handleCopyAddress()}
            className="inline-flex items-center gap-1 text-xs font-mono text-gray-500 hover:text-gray-700"
            title={creatorAddress}
            aria-label="Copy creator address"
          >
            <Copy size={14} strokeWidth={2} aria-hidden="true" />
            <span>{truncateAddress(creatorAddress)}</span>
          </button>
          <Link href={`/user/${encodeURIComponent(creatorHandle)}`} className="campaign-card-handle-link">
            {creatorHandle}
          </Link>
          {copyFeedback === "copied" ? <span className="text-[11px] text-green-600">Copied</span> : null}
          {copyFeedback === "error" ? <span className="text-[11px] text-red-500">Copy failed</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <span className={`status-indicator status-${getStatusClassName(displayStatus)}`} title={STATUS_LABELS[displayStatus] ?? String(displayStatus)} />
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-2 text-xs text-gray-500">
        <span className="font-medium text-gray-800">{TYPE_LABELS[campaignType] ?? String(campaignType)}</span>
        {isRaffleCampaign && ticketPriceLabel ? (
          <>
            <span className="campaign-card-ticket-price">
              1 <Ticket className="campaign-card-inline-ticket" size={16} strokeWidth={2} aria-hidden="true" /> = {ticketPriceLabel} CKB
            </span>
            {rewardCountValue > 0 ? (
              <>
                <span className="font-medium text-gray-800">then:</span>
                <span className={`campaign-card-ticket-price ${shouldGlowSettlement ? "campaign-card-ticket-price-pending" : "campaign-card-ticket-price-settled"}`.trim()}>
                  take {String(rewardCountValue)}
                </span>
              </>
            ) : null}
          </>
        ) : null}
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
        {shouldShowReadMore ? (
          <button
            type="button"
            className="campaign-card-read-more"
            onClick={() => setIsDescriptionExpanded((current) => !current)}
          >
            {isDescriptionExpanded ? "Show less" : "Read more..."}
          </button>
        ) : null}
      </div>

      {record.socialMetadata?.mentions?.length ? (
        <div className="flex flex-wrap gap-2 text-xs">
          {record.socialMetadata.mentions.map((mention) => (
            <span key={mention} className="px-2 py-1 rounded border border-gray-300 text-gray-600">@{mention}</span>
          ))}
        </div>
      ) : null}

      {!campaign ? (
        <p className="text-[11px] text-gray-400">
          {chainSyncError || (isChainSyncing ? "Syncing live chain data..." : "Live chain data unavailable right now.")}
        </p>
      ) : null}

      <div className="campaign-card-footer">
        <div className="campaign-card-footer-meta">
          {record.mountables?.forms?.enabled ? (
            <span className="campaign-card-mounted-icon" title="Forms mounted" aria-label="Forms mounted">
              <Scroll size={22} strokeWidth={2} aria-hidden="true" />
            </span>
          ) : null}
          <span className="text-xs font-mono text-gray-400 break-all">
            {txHash ? (
              <a
                href={`https://pudge.explorer.nervos.org/transaction/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                {shortHash}
              </a>
            ) : shortHash}
          </span>
          <span className="campaign-card-created-date">Created {createdAtDate}</span>
        </div>
        <span className={countdownClassName} title={countdownTitle} aria-label={`${countdownTitle} ${countdown.text}`}>
          {countdown.text}
        </span>
      </div>
    </div>
  );
}
