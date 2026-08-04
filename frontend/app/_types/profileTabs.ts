export type ProfileFreightInteractionKind = "rewarded" | "created" | "participated" | "commented";

export type ProfileFreightRow = {
  campaignId: string;
  campaignRecordId: string | null;
  creatorAddress: string | null;
  creatorHandle: string;
  href: string;
  interactionKinds: ProfileFreightInteractionKind[];
  latestInteractionAt: string;
  strongestInteraction: ProfileFreightInteractionKind;
  title: string;
};

export type ProfileTransactionChannel = "onchain" | "offchain" | "hybrid";
export type ProfileTransactionRole = "actor" | "recipient";
export type ProfileTransactionKind =
  | "wallet_seed"
  | "freight_create"
  | "campaign_activate"
  | "campaign_participation"
  | "campaign_deposit"
  | "campaign_settlement"
  | "campaign_reward";

export type ProfileTransactionRow = {
  adsfUsdCentsDelta: number | null;
  amountLabel: string | null;
  campaignId: string | null;
  campaignRecordId: string | null;
  campaignTitle: string | null;
  ckbUsdCentsDelta: number | null;
  channel: ProfileTransactionChannel;
  fbarsDelta: number | null;
  id: string;
  kind: ProfileTransactionKind;
  occurredAt: string;
  onchainNetDeltaShannons: string | null;
  role: ProfileTransactionRole;
  summary: string;
  txHash: string | null;
};

export type ProfileTransactionsCoverage = {
  complete: boolean;
  notes: string[];
};
