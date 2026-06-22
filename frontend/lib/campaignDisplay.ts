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

export function buildDefaultHandle(addressHex: string) {
  const normalized = addressHex.toLowerCase().replace(/^0x/, "");
  return `freight${normalized.slice(-20)}.ckb`;
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
