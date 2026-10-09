import type { AppMountableConfig } from "@/app/_types/appMountable";
import type { ChildFreightMountableConfig } from "@/app/_lib/childFreightMountable";
import type { FormsMountableConfig } from "@/app/_types/formsMountable";
import type { LockMountableConfig } from "@/app/_types/lockMountable";
import type { CampaignAttachment } from "@/app/_types/campaignAttachments";
import type { GiftDeliverable } from "@/lib/giftDeliverables";
import type { RaffleApprovalConfig } from "@/lib/raffleApproval";

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
  parentCampaignId?: string | null;
  parentCampaignIds?: string[] | null;
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
    raffleSupportPoolPercent?: string;
    ticketsPerUser?: string;
    recurringSleepHours?: string;
    winnerReductionPercent?: string;
  };
  mountables?: {
    childFreight?: ChildFreightMountableConfig | null;
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
  raffleApproval?: RaffleApprovalConfig | null;
  attachments?: CampaignAttachment[];
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
  withdrawalTxHash?: string | null;
  withdrawnAt?: string | null;
  withdrawnByAddress?: string | null;
  withdrawnAmountShannons?: string | null;
};
