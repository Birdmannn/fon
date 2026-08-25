import { ccc } from "@ckb-ccc/connector-react";

import { CampaignStatus } from "@/lib/contract";
import { bytesToHex, computeCreatorWithdrawableAmount, computeRaffleRewardPool } from "@/lib/encoding";
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

export function formatWholeCkbAmount(value: bigint) {
  return (value / 100_000_000n).toString();
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
  soldTicketCount?: string | null;
  liveSoldTickets?: bigint | null;
}) {
  const { campaign, displayStatus, settlementTxHash, soldTicketCount, liveSoldTickets: liveSoldTicketsOverride } = args;
  const isRaffleCampaign = campaign.data.campaignType === 4;
  const hasSettlementRecord = typeof settlementTxHash === "string" && settlementTxHash.trim().length > 0;
  const snapshotSoldTickets = typeof soldTicketCount === "string" && soldTicketCount.trim().length > 0
    ? BigInt(soldTicketCount.trim())
    : null;
  const liveSoldTickets = liveSoldTicketsOverride ?? 0n;
  const soldTickets = hasSettlementRecord && snapshotSoldTickets !== null ? snapshotSoldTickets : liveSoldTickets;
  const hasSettledRewards = isRaffleCampaign
    && displayStatus === CampaignStatus.Completed
    && (computeRaffleRewardPool(campaign.data) === 0n || hasSettlementRecord);
  const shouldGlowSettlement = isRaffleCampaign
    && displayStatus === CampaignStatus.Completed
    && campaign.data.rewardCount > 0n
    && !hasSettledRewards;
  const showSettlementAction = isRaffleCampaign
    && displayStatus === CampaignStatus.Completed
    && soldTickets > 0n;

  return {
    hasSettledRewards,
    showSettlementAction,
    shouldGlowSettlement,
    soldTickets,
  };
}

export function deriveCreatorWithdrawUiState(args: {
  campaign: CampaignCell;
  displayStatus: CampaignStatus;
  withdrawalTxHash?: string | null;
}) {
  const { campaign, displayStatus, withdrawalTxHash } = args;
  const hasWithdrawalRecord = typeof withdrawalTxHash === "string" && withdrawalTxHash.trim().length > 0;
  const withdrawableAmount = hasWithdrawalRecord ? 0n : computeCreatorWithdrawableAmount(campaign.data);
  const completedWithdrawalReady = displayStatus === CampaignStatus.Completed && campaign.data.supportPoolBps === 0n;
  const cancelledWithdrawalReady = displayStatus === CampaignStatus.Cancelled;
  const canWithdraw = withdrawableAmount > 0n && (completedWithdrawalReady || cancelledWithdrawalReady);

  return {
    canWithdraw,
    hasWithdrawalRecord,
    withdrawableAmount,
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
