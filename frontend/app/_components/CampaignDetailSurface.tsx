"use client";

import Link from "next/link";

import CampaignDescriptionContent from "@/app/_components/CampaignDescriptionContent";
import type { CampaignRecord } from "@/app/_types/campaignRecords";
import {
  buildDefaultHandle,
  decodeCreatedByAddress,
} from "@/lib/campaignDisplay";
import { stripGiftDirectiveMarkers } from "@/lib/giftDeliverables";
import { decodeSummary } from "@/lib/encoding";
import type { CampaignCell } from "@/lib/transactions";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type CampaignDetailSurfaceProps = {
  campaign: CampaignCell | null;
  chainSyncError?: string;
  isChainSyncing?: boolean;
  nowMs?: number;
  record: CampaignRecord;
};

function sanitizeCampaignDescription(text: string) {
  return text
    .replace(/(^|\s)#(?:simpletask|fundedtask|crowdfunding|timedchallenge|raffle|mounted)\b/gi, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export default function CampaignDetailSurface({
  campaign,
  record,
}: CampaignDetailSurfaceProps) {
  const createdByFallback = record.createdByHash?.trim() || (campaign ? decodeCreatedByAddress(campaign) : ZERO_ADDRESS);
  const creatorAddress = record.creatorAddress?.trim() || createdByFallback;
  const creatorHandle = record.creatorHandle?.trim() || buildDefaultHandle(creatorAddress);
  const summary = record.summaryDraft?.trim() || (campaign ? decodeSummary(campaign.data.summary) : "Untitled freight");
  const displayTitle = record.title?.trim() || summary;
  const rawDescription = record.description?.trim() || summary;
  const displayDescription = sanitizeCampaignDescription(stripGiftDirectiveMarkers(rawDescription));
  const descriptionLines = displayDescription.length > 0 ? displayDescription.split("\n") : [];

  return (
    <div className="campaign-card-surface campaign-card-surface-detail p-4">
      <div className="campaign-card-body campaign-card-body-detail">
        <div className="campaign-detail-card-heading">
          <h1 className="campaign-detail-card-title">{displayTitle}</h1>
          <p className="campaign-detail-card-byline">
            <span>by</span>
            <Link href={`/user/${encodeURIComponent(creatorHandle)}`} className="campaign-card-handle-link">
              {creatorHandle}
            </Link>
          </p>
        </div>

        <div className="campaign-card-content campaign-card-content-detail">
          {record.giftDeliverable?.enabled ? (
            <div className="campaign-gift-meta-row campaign-gift-meta-row-detail">
              <span className="campaign-gift-pill">Gift</span>
              <span className="campaign-gift-copy">
                {record.giftDeliverable.claimants?.length ? `${record.giftDeliverable.claimants.length} tagged claimants` : "Open claim"}
              </span>
              <span className="campaign-gift-copy">
                {record.giftDeliverable.splitMode ? `${record.giftDeliverable.splitMode} split` : "split pending"}
              </span>
            </div>
          ) : null}
          <div className="campaign-card-description campaign-card-description-detail">
            <CampaignDescriptionContent lines={descriptionLines} />
          </div>
        </div>
      </div>
    </div>
  );
}
