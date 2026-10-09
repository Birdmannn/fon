import { CampaignStatus, CampaignType } from "./contract.ts";
import type { CampaignData } from "./encoding.ts";
import { deriveRequiredApprovalCount, type GiftDeliverable } from "./giftDeliverables.ts";
import { raffleApprovalsSatisfied, type CampaignApprovalConfig, type RaffleApprovalState } from "./raffleApproval.ts";

export function buildGiftApprovalConfig(gift: GiftDeliverable): CampaignApprovalConfig | null {
  if (!gift.enabled || !gift.approvers.length) return null;
  return { stage: "gift-commence", required: deriveRequiredApprovalCount(gift.approvers.length, gift.approvalRule)!, approvers: gift.approvers.map((entry) => ({ handle: entry.handle, address: entry.address ?? null })) };
}

export function isOnChainGiftApprovalSatisfied(gift: GiftDeliverable | null | undefined, approval?: RaffleApprovalState | null) {
  if (approval?.stage === "gift-commence") return raffleApprovalsSatisfied(approval);
  if (approval && gift?.enabled) return false;
  return !gift?.enabled || !gift.approvers.length;
}

export function isOnChainGiftClaimOpen(campaign: CampaignData, gift: GiftDeliverable, nowMs = Date.now()) {
  return campaign.campaignType === CampaignType.FundedTask && gift.enabled
    && campaign.status !== CampaignStatus.Cancelled && campaign.status !== CampaignStatus.Completed
    && isOnChainGiftApprovalSatisfied(gift, campaign.approval)
    && BigInt(Math.trunc(nowMs)) >= campaign.createdAt + campaign.startDurationSecs * 1000n;
}
