"use client";

import Image from "next/image";
import Link from "next/link";
import { Blocks, Copy, HandCoins, LockKeyhole, Scroll, Signature, Ticket } from "lucide-react";
import { useMemo, useState } from "react";

import CampaignDescriptionContent from "@/app/_components/CampaignDescriptionContent";
import CampaignAttachmentGrid from "@/app/_components/CampaignAttachmentGrid";
import type { CampaignRecord } from "@/app/_types/campaignRecords";
import {
  buildDefaultHandle,
  decodeCreatedByAddress,
  deriveRaffleSettlementUiState,
  formatCkbAmount,
} from "@/lib/campaignDisplay";
import { compactDescriptionBlankLines } from "@/lib/campaignDescription";
import { stripCampaignControlTags } from "@/lib/campaignTipping";
import { CampaignStatus, CampaignType } from "@/lib/contract";
import { isWinningCampaignType } from "@/lib/fbars";
import { stripGiftDirectiveMarkers } from "@/lib/giftDeliverables";
import { decodeSummary, hasSplitSupportAccounting } from "@/lib/encoding";
import type { CampaignCell } from "@/lib/transactions";

type CampaignCountdownTone = "good" | "warn" | "danger" | "ended";
type CampaignCountdownPhase = "start" | "duration" | "ended";

const STATUS_LABELS = ["Created", "Active", "Completed", "Cancelled", "Sleeping", "Finished"];
const TYPE_LABELS = ["Simple Task", "FundedTask", "Crowdfunding", "Timed Challenge", "Raffle", "Recurring Raffle"];
const CAMPAIGN_CARD_PREVIEW_MAX_CHARS = 280;

function formatCountdownSegment(value: number) {
  return String(Math.max(0, value)).padStart(2, "0");
}

function buildCampaignCountdown(campaign: CampaignCell, nowMs: number) {
  const recurring = campaign.data.campaignType === CampaignType.RecurringRaffle;
  const createdAtMs = recurring ? Number(campaign.data.roundStartedAt ?? campaign.data.createdAt) : Number(campaign.data.createdAt);
  const startDelayMs = Math.max(0, Number(campaign.data.startDurationSecs) * 1000);
  const sleeping = recurring && campaign.data.status === CampaignStatus.Sleeping;
  const durationMs = Math.max(0, Number(sleeping ? campaign.data.sleepDurationSecs ?? 0n : campaign.data.taskDurationSecs) * 1000);
  const startsAtMs = sleeping
    ? createdAtMs + Number(campaign.data.taskDurationSecs) * 1000
    : recurring ? createdAtMs : createdAtMs + startDelayMs;
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
  return stripCampaignControlTags(text);
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
    case CampaignStatus.Finished:
      return "completed";
    case CampaignStatus.Cancelled:
      return "cancelled";
    case CampaignStatus.Created:
    case CampaignStatus.Sleeping:
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
  creatorPhotoUpdatedAt?: string | null;
  displayStatus: CampaignStatus;
  isHighlighted?: boolean;
  nowMs: number;
  onOpenDetail?: () => void;
  onMountablesClick?: () => void;
  record: CampaignRecord | null;
  variant?: "feed" | "detail";
};

export default function CampaignCardSurface({
  campaign,
  creatorPhotoUpdatedAt,
  displayStatus,
  isHighlighted = false,
  nowMs,
  onOpenDetail,
  onMountablesClick,
  record,
  variant = "feed",
}: CampaignCardSurfaceProps) {
  const { data, outPoint } = campaign;
  const shortHash = outPoint.txHash.slice(0, 10) + "…";
  const createdAtDate = new Date(Number(data.createdAt)).toLocaleDateString();
  const isRaffleCampaign = data.campaignType === CampaignType.Raffle || data.campaignType === CampaignType.RecurringRaffle;
  const ticketPriceShannons = data.auxAmount > 0n ? data.auxAmount : 0n;
  const displayTitle = record?.title?.trim() || decodeSummary(data.summary);
  const rawDescription = record?.description?.trim() || decodeSummary(data.summary);
  const displayDescription = compactDescriptionBlankLines(
    sanitizeCampaignDescription(stripGiftDirectiveMarkers(rawDescription))
  );
  const creatorAddress = record?.creatorAddress || decodeCreatedByAddress(campaign);
  const creatorHandle = record?.creatorHandle || buildDefaultHandle(creatorAddress);
  const creatorPhotoUrl = creatorPhotoUpdatedAt
    ? `/api/user-profiles/photo?address=${encodeURIComponent(creatorAddress)}&v=${encodeURIComponent(creatorPhotoUpdatedAt)}`
    : null;
  const mentions = record?.socialMetadata?.mentions ?? [];
  const giftDeliverable = record?.giftDeliverable;
  const isSignable = (giftDeliverable?.approvers?.length ?? 0) > 0;
  const rewardCountValue = Number(data.rewardCount);
  const supportPoolPercent = Number.parseInt(
    record?.argsDraft?.raffleSupportPoolPercent
      ?? (hasSplitSupportAccounting(data) ? String(Number(data.supportPoolBps / 100n)) : "0"),
    10
  );
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
  const isSimpleTask = campaign.data.campaignType === CampaignType.SimpleTask;
  const timedCountdown = buildCampaignCountdown(campaign, nowMs);
  const countdown = isSimpleTask
    ? { text: displayStatus === CampaignStatus.Cancelled ? "Closed" : "Ongoing", tone: displayStatus === CampaignStatus.Cancelled ? "ended" as const : "good" as const }
    : timedCountdown;
  const countdownTitle = isSimpleTask
    ? countdown.text
    : campaign.data.campaignType === CampaignType.RecurringRaffle && displayStatus === CampaignStatus.Sleeping ? "Cash-out ends in"
    : timedCountdown.phase === "start" ? "Starts in" : timedCountdown.phase === "duration" ? "Ends in" : "Ended";
  const countdownClassName = `campaign-card-countdown campaign-card-countdown-${countdown.tone}`;
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "copied" | "error">("idle");
  const [loadedCreatorPhotoUrl, setLoadedCreatorPhotoUrl] = useState<string | null>(null);
  const isCreatorPhotoLoaded = creatorPhotoUrl !== null && loadedCreatorPhotoUrl === creatorPhotoUrl;
  const mountedIcons = [
    ...(record?.mountables?.forms?.enabled ? [{ key: "forms", name: "Forms", kind: "forms" as const, logoUrl: "" }] : []),
    ...(record?.mountables?.lock?.enabled ? [{ key: "lock", name: "Lock", kind: "lock" as const, logoUrl: "" }] : []),
    ...(isWinningCampaignType(campaign.data.campaignType) ? [{ key: "rewardable", name: "Rewardable", kind: "rewardable" as const, logoUrl: "" }] : []),
    ...(isSignable ? [{ key: "signable", name: "Signable", kind: "signable" as const, logoUrl: "" }] : []),
    ...(record?.mountables?.apps ?? []).filter((entry) => entry.enabled).map((entry) => ({
      key: entry.mountableInstanceId || entry.appId,
      name: entry.appName || entry.appId,
      kind: "app" as const,
      logoUrl: entry.logoUrl || entry.iconUrl,
    })),
  ].sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }));
  const visibleMountedIcons = mountedIcons.length >= 4 ? mountedIcons.slice(0, 3) : mountedIcons;
  const hiddenMountedIconCount = mountedIcons.length - visibleMountedIcons.length;

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
    "campaign-card-surface flex flex-col gap-4",
    variant === "feed"
      ? "campaign-card-surface-feed campaign-card-surface-bordered rounded-lg p-4 campaign-card-surface-sized"
      : "campaign-card-surface-detail p-4",
    onOpenDetail ? "campaign-card-surface-interactive" : "",
    isHighlighted ? "campaign-card-highlighted" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={rootClassName} onClick={onOpenDetail} role={onOpenDetail ? "button" : undefined} tabIndex={onOpenDetail ? 0 : undefined}>
      <div className="campaign-card-body campaign-card-body-feed">
        <div className="campaign-card-creator-header">
          <div className="campaign-card-creator-meta">
            <div className="campaign-card-creator-primary-line">
              <span
                className={`status-indicator status-${getStatusClassName(displayStatus)}`}
                data-tooltip={STATUS_LABELS[displayStatus] ?? String(displayStatus)}
                aria-label={STATUS_LABELS[displayStatus] ?? String(displayStatus)}
              />
              <button
                type="button"
                onClick={handleCopyAddress}
                className="inline-flex items-center gap-1 text-xs font-mono text-gray-500 hover:text-gray-700"
                aria-label="Copy creator address"
              >
                <Copy size={14} strokeWidth={2} aria-hidden="true" />
                <span>{truncateAddress(creatorAddress)}</span>
              </button>
              <Link
                href={`/user/${encodeURIComponent(creatorHandle)}`}
                className="campaign-card-handle-link"
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                {creatorHandle}
              </Link>
              {copyFeedback === "copied" && <span className="text-[11px] text-green-600">Copied</span>}
              {copyFeedback === "error" && <span className="text-[11px] text-red-500">Copy failed</span>}
            </div>

            <div className="campaign-card-creator-secondary-line">
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
                      {supportPoolPercent > 0 ? (
                        <>
                          <span className="font-medium text-gray-800">with:</span>
                          <span className="campaign-card-ticket-price">{supportPoolPercent}%</span>
                        </>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
          <Link
            href={`/user/${encodeURIComponent(creatorHandle)}`}
            className={`campaign-card-creator-photo ${isCreatorPhotoLoaded ? "campaign-card-creator-photo-image" : "campaign-card-creator-photo-fallback"}`.trim()}
            aria-label={`View ${creatorHandle} profile`}
            onClick={(event) => event.stopPropagation()}
          >
            {!isCreatorPhotoLoaded ? (
              <span className="campaign-card-creator-photo-fallback-inner" aria-hidden="true" />
            ) : null}
            {creatorPhotoUrl ? (
              <Image
                src={creatorPhotoUrl}
                alt=""
                width={44}
                height={44}
                unoptimized
                className={`campaign-card-creator-photo-source ${isCreatorPhotoLoaded ? "campaign-card-creator-photo-source-loaded" : ""}`.trim()}
                onLoad={() => setLoadedCreatorPhotoUrl(creatorPhotoUrl)}
                onError={() => setLoadedCreatorPhotoUrl((current) => current === creatorPhotoUrl ? null : current)}
              />
            ) : null}
          </Link>
        </div>

        <div className="campaign-card-content campaign-card-content-feed">
          <h3 className="campaign-card-title text-xl font-semibold leading-tight text-gray-900">{displayTitle}</h3>
          <div className={`campaign-card-description-wrap ${isDescriptionExpanded ? "campaign-card-description-wrap-expanded" : ""}`}>
            <div className="campaign-card-description campaign-card-description-feed">
              <CampaignDescriptionContent lines={descriptionLines} />
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

        <CampaignAttachmentGrid attachments={record?.attachments ?? []} />

        {mentions.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {mentions.map((mention) => (
              <span key={mention} className="px-2 py-1 rounded border border-gray-300 text-gray-600">@{mention}</span>
            ))}
          </div>
        )}

        {giftDeliverable?.enabled ? (
          <div className="campaign-gift-meta-row">
            <span className="campaign-gift-pill">Gift</span>
            <span className="campaign-gift-copy">
              {giftDeliverable.claimants?.length ? `${giftDeliverable.claimants.length} tagged claimants` : "Open claim"}
            </span>
            <span className="campaign-gift-copy">
              {giftDeliverable.splitMode ? `${giftDeliverable.splitMode} split` : "split pending"}
            </span>
          </div>
        ) : null}
      </div>

      <div className="campaign-card-footer">
        <div className="campaign-card-footer-meta">
          {mountedIcons.length > 0 ? (
            <button
              type="button"
              className="campaign-card-mountable-icons"
              aria-label="View mountables"
              onClick={(event) => {
                event.stopPropagation();
                onMountablesClick?.();
              }}
            >
              {visibleMountedIcons.map((mountable, index) => (
                <span
                  className={`campaign-card-mounted-icon ${mountable.kind === "app" && mountable.logoUrl ? "campaign-card-mounted-icon-logo" : ""}`.trim()}
                  data-tooltip={mountable.name}
                  aria-label={mountable.name}
                  key={mountable.key}
                  style={{ zIndex: index + 1 }}
                >
                  {mountable.kind === "app" ? (
                    mountable.logoUrl ? (
                      <Image src={mountable.logoUrl} alt="" width={38} height={38} unoptimized />
                    ) : (
                      <Blocks size={20} strokeWidth={2} aria-hidden="true" />
                    )
                  ) : mountable.kind === "forms" ? (
                    <Scroll size={22} strokeWidth={2} aria-hidden="true" />
                  ) : mountable.kind === "signable" ? (
                    <Signature size={22} strokeWidth={2} aria-hidden="true" />
                  ) : mountable.kind === "rewardable" ? (
                    <HandCoins size={22} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <LockKeyhole size={22} strokeWidth={2} aria-hidden="true" />
                  )}
                </span>
              ))}
              {hiddenMountedIconCount > 0 ? (
                <span
                  className="campaign-card-mounted-icon campaign-card-mounted-icon-overflow"
                  data-tooltip={`${hiddenMountedIconCount} more ${hiddenMountedIconCount === 1 ? "mountable" : "mountables"}`}
                  aria-label={`${hiddenMountedIconCount} more ${hiddenMountedIconCount === 1 ? "mountable" : "mountables"}`}
                  style={{ zIndex: visibleMountedIcons.length + 1 }}
                >
                  +{hiddenMountedIconCount}
                </span>
              ) : null}
            </button>
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
        <span className={countdownClassName} data-tooltip={countdownTitle} aria-label={isSimpleTask ? countdown.text : `${countdownTitle} ${countdown.text}`}>
          {countdown.text}
        </span>
      </div>
    </div>
  );
}
