import type { FormsMountableConfig } from "@/app/_types/formsMountable";

export type CampaignComment = {
  text: string;
  creatorAddress?: string | null;
  creatorHandle?: string | null;
  createdAt?: string;
};

export type CampaignRecord = {
  _id?: string;
  title?: string;
  description?: string;
  campaignId?: string | null;
  createdByHash?: string | null;
  chainCreatedAt?: string | null;
  campaignType?: number;
  summaryDraft?: string;
  argsDraft?: {
    taskStartDelayHours?: string;
    taskDurationHours?: string;
    maxAmountCkb?: string;
    auxAmountCkb?: string;
    rewardCount?: string;
  };
  mountables?: {
    forms?: FormsMountableConfig | null;
  };
  socialMetadata?: {
    mentions?: string[];
    comments?: unknown[];
    likeCount?: number;
    likedByAddresses?: string[];
    bookmarkCount?: number;
    reshareCount?: number;
    resharedByAddresses?: string[];
  };
  creatorAddress?: string | null;
  creatorHandle?: string | null;
  status?: "draft" | "published" | "publish_failed";
  txHash?: string | null;
  publishError?: string | null;
  randomnessPreimage?: string | null;
  activatedTxHash?: string | null;
  settlementTxHash?: string | null;
  settledAt?: string | null;
  soldTicketCount?: string | null;
  settledParticipantCount?: string | null;
  settledRecipients?: Array<{
    address: string;
    username: string;
    handle: string;
    amountLabel: string;
  }> | null;
};
