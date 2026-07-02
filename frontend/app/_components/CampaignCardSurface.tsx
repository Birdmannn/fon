"use client";

import { Copy, Scroll, Ticket } from "lucide-react";
import { useMemo, useState } from "react";

import {
  buildDefaultHandle,
  decodeCreatedByAddress,
  deriveRaffleSettlementUiState,
  formatCkbAmount,
} from "@/lib/campaignDisplay";
import { CampaignStatus } from "@/lib/contract";
import { decodeSummary } from "@/lib/encoding";
import type { CampaignCell } from "@/lib/transactions";

type CampaignRecord = {
  title?: string;
  description?: string;
  creatorAddress?: string | null;
  creatorHandle?: string | null;
  settlementTxHash?: string | null;
  soldTicketCount?: string | null;
  mountables?: {
    forms?: {
      enabled?: boolean;
      formUrl?: string;
      canonicalFormUrl?: string;
      formId?: string;
      validatedAt?: string;
    } | null;
  };
  socialMetadata?: {
    mentions?: string[];
  };
};

type CampaignCountdownTone = "good" | "warn" | "danger" | "ended";
type CampaignCountdownPhase = "start" | "duration" | "ended";

const STATUS_LABELS = ["Created", "Active", "Completed", "Cancelled"];
const TYPE_LABELS = ["Simple Task", "FundedTask", "Crowdfunding", "Timed Challenge", "Raffle"];
const CAMPAIGN_CARD_PREVIEW_MAX_CHARS = 280;

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

async function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  throw new Error("Clipboard API unavailable");
}

type CampaignCardSurfaceProps = {
  campaign: CampaignCell;
  displayStatus: CampaignStatus;
  isHighlighted?: boolean;
  nowMs: number;
  onOpenDetail?: () => void;
  record: CampaignRecord | null;
  variant?: "feed" | "detail";
};

export default function CampaignCardSurface({
  campaign,
  displayStatus,
  isHighlighted = false,
  nowMs,
  onOpenDetail,
  record,
  variant = "feed",
}: CampaignCardSurfaceProps) {
  const { data, outPoint } = campaign;
  const shortHash = outPoint.txHash.slice(0, 10) + "…";
  const createdAtDate = new Date(Number(data.createdAt)).toLocaleDateString();
  const isRaffleCampaign = data.campaignType === 4;
  const ticketPriceShannons = data.auxAmount > 0n ? data.auxAmount : 0n;
  const displayTitle = record?.title?.trim() || decodeSummary(data.summary);
  const displayDescription = sanitizeCampaignDescription(record?.description?.trim() || decodeSummary(data.summary));
  const creatorAddress = record?.creatorAddress || decodeCreatedByAddress(campaign);
  const creatorHandle = record?.creatorHandle || buildDefaultHandle(creatorAddress);
  const mentions = record?.socialMetadata?.mentions ?? [];
  const rewardCountValue = Number(data.rewardCount);
  const shouldGlowSettlement = deriveRaffleSettlementUiState({
    campaign,
    displayStatus,
    settlementTxHash: record?.settlementTxHash ?? null,
    soldTicketCount: record?.soldTicketCount ?? null,
  }).shouldGlowSettlement;
  const collapsedDescription = useMemo(
    () => truncateCampaignDescription(displayDescription, variant === "detail" ? 1200 : CAMPAIGN_CARD_PREVIEW_MAX_CHARS),
    [displayDescription, variant]
  );
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(variant === "detail");
  const shouldShowReadMore = collapsedDescription.truncated;
  const visibleDescription = isDescriptionExpanded ? displayDescription : collapsedDescription.text;
  const descriptionLines = visibleDescription.length > 0 ? visibleDescription.split("\n") : [];
  const countdown = buildCampaignCountdown(campaign, nowMs);
  const countdownTitle = countdown.phase === "start" ? "Starts in" : countdown.phase === "duration" ? "Ends in" : "Ended";
  const countdownClassName = `campaign-card-countdown campaign-card-countdown-${countdown.tone}`;
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "error">("idle");

  const handleCopyAddress = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await copyText(creatorAddress);
      setCopyFeedback("copied");
      window.setTimeout(() => setCopyFeedback("idle"), 1200);
    } catch {
      setCopyFeedback("error");
      window.setTimeout(() => setCopyFeedback("idle"), 1200);
    }
  };

  const rootClassName = [
    "campaign-card-surface border border-gray-200 rounded-lg p-4 flex flex-col gap-4",
    variant === "feed" ? "campaign-card-surface-sized" : "campaign-card-surface-detail",
    onOpenDetail ? "campaign-card-surface-interactive" : "",
    isHighlighted ? "campaign-card-highlighted" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={rootClassName} onClick={onOpenDetail} role={onOpenDetail ? "button" : undefined} tabIndex={onOpenDetail ? 0 : undefined}>
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
                <span className={`campaign-card-ticket-price ${shouldGlowSettlement ? "campaign-card-ticket-price-pending" : "campaign-card-ticket-price-settled"}`}>take {String(rewardCountValue)}</span>
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
            onClick={(event) => {
              event.stopPropagation();
              setIsDescriptionExpanded((current) => !current);
            }}
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
          {record?.mountables?.forms?.enabled ? (
            <span className="campaign-card-mounted-icon" title="Forms mounted" aria-label="Forms mounted">
              <Scroll size={22} strokeWidth={2} aria-hidden="true" />
            </span>
          ) : null}
          <span className="text-xs font-mono text-gray-400 break-all">
            <a
              href={`https://pudge.explorer.nervos.org/transaction/${outPoint.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              onClick={(event) => event.stopPropagation()}
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
  );
}
