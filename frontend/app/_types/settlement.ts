import type { CampaignRecord } from "@/app/_hooks/useCampaignFeed";
import type { CampaignCell } from "@/lib/transactions";

export type SettlementRecipient = {
  address: string;
  username: string;
  handle: string;
  amountLabel: string;
  amountShannons: string;
};

export type SettlementModalData = {
  campaignTitle: string;
  randomnessHash: string;
  randomnessPreimage: string | null;
  evidenceItems: string[];
  recipients: SettlementRecipient[];
  distributionTxHash: string | null;
  errorMessage?: string | null;
  _campaign?: CampaignCell;
  _record?: CampaignRecord | null;
};
