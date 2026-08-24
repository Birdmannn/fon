import type { AppMountableConfig } from "@/app/_types/appMountable";
import type { FormsMountableConfig } from "@/app/_types/formsMountable";
import type { LockMountableConfig } from "@/app/_types/lockMountable";
import type { GiftDeliverable } from "@/lib/giftDeliverables";

export type CampaignComment = {
  text: string;
  creatorAddress?: string | null;
  creatorHandle?: string | null;
  createdAt?: string;
};

export type CampaignSettledRecipient = {
  address: string;
  username: string;
  handle: string;
  amountLabel: string;
  amountShannons: string;
  creditedUsdCents?: number | null;
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
    lock?: LockMountableConfig | null;
    apps?: AppMountableConfig[];
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
  giftDeliverable?: GiftDeliverable | null;
  creatorAddress?: string | null;
  creatorHandle?: string | null;
  status?: "draft" | "published" | "publish_failed";
  txHash?: string | null;
  publishError?: string | null;
  randomnessPreimage?: string | null;
  activatedTxHash?: string | null;
  activatedAt?: string | null;
  activatedByAddress?: string | null;
  settlementTxHash?: string | null;
  settledAt?: string | null;
  settledByAddress?: string | null;
  soldTicketCount?: string | null;
  liveSoldTicketCount?: string | null;
  settledParticipantCount?: string | null;
  settledRecipients?: CampaignSettledRecipient[] | null;
};
