import type { CampaignSupportMode } from "@/lib/campaignTipping";

export type CampaignSupportRequest = {
  supportMode: CampaignSupportMode;
  submit: (amountCkb: string) => Promise<string>;
};
