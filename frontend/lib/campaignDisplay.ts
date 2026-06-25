import { ccc } from "@ckb-ccc/connector-react";

import { CampaignStatus } from "@/lib/contract";
import { bytesToHex } from "@/lib/encoding";
import type { CampaignCell } from "@/lib/transactions";

export function deriveDisplayStatus(campaign: CampaignCell, nowMs: number = Date.now()) {
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

export function formatCkbAmount(value: bigint) {
  return (Number(value) / 1e8).toFixed(2);
}

export function buildDefaultUsername(addressHex: string) {
  const normalized = addressHex.toLowerCase().replace(/^0x/, "");
  return `freight${normalized.slice(-20)}`;
}

export function formatUsernameHandle(username: string) {
  const normalized = username.trim().replace(/\.ckb$/i, "");
  return normalized ? `${normalized}.ckb` : "";
}

export function buildDefaultHandle(addressHex: string) {
  return formatUsernameHandle(buildDefaultUsername(addressHex));
}

export function normalizeUsername(value: string) {
  return value.trim().replace(/\.ckb$/i, "").toLowerCase();
}

export function deriveRaffleSettlementUiState(args: {
  campaign: CampaignCell;
  displayStatus: CampaignStatus;
  settlementTxHash?: string | null;
}) {
  const { campaign, displayStatus, settlementTxHash } = args;
  const isRaffleCampaign = campaign.data.campaignType === 4;
  const ticketPriceShannons = campaign.data.auxAmount > 0n ? campaign.data.auxAmount : 0n;
  const soldTickets = isRaffleCampaign && ticketPriceShannons > 0n ? campaign.data.currentDeposits / ticketPriceShannons : 0n;
  const hasSettlementRecord = typeof settlementTxHash === "string" && settlementTxHash.trim().length > 0;
  const hasSettledRewards = isRaffleCampaign
    && displayStatus === CampaignStatus.Completed
    && (campaign.data.currentDeposits === 0n || hasSettlementRecord);
  const shouldGlowSettlement = isRaffleCampaign
    && displayStatus === CampaignStatus.Completed
    && campaign.data.rewardCount > 0n
    && !hasSettledRewards;
  const showSettlementAction = isRaffleCampaign
    && displayStatus === CampaignStatus.Completed
    && (soldTickets > 0n || hasSettlementRecord);

  return {
    hasSettledRewards,
    showSettlementAction,
    shouldGlowSettlement,
    soldTickets,
  };
}

export function decodeCreatedByAddress(campaign: CampaignCell) {
  return bytesToHex(campaign.data.createdBy);
}

export function deriveChainLabel(client: ccc.Client) {
  if (client instanceof ccc.ClientPublicMainnet) {
    return "Mainnet";
  }

  if (client instanceof ccc.ClientPublicTestnet) {
    return "Testnet";
  }

  return "Custom";
}
