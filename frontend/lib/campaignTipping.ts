import { CampaignType } from "@/lib/contract";

export type CampaignDepositKind = "campaign_deposit" | "simple_task_tip";
export type CampaignSupportMode = "campaign_escrow" | "direct_creator";

const CONTROL_TAG_PATTERN = /(^|\s)#(?:simpletask|fundedtask|crowdfunding|timedchallenge|raffle|mounted|non-tippable)\b/gi;
const NON_TIPPABLE_TAG_PATTERN = /(^|\s)#non-tippable\b/i;

export function stripCampaignControlTags(text: string) {
  return text
    .replace(CONTROL_TAG_PATTERN, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function hasNonTippableTag(description: string | null | undefined) {
  return NON_TIPPABLE_TAG_PATTERN.test(description ?? "");
}

export function deriveCampaignSupportMode(campaignType: number): CampaignSupportMode {
  return campaignType === CampaignType.SimpleTask ? "direct_creator" : "campaign_escrow";
}

export function deriveCampaignDepositKind(supportMode: CampaignSupportMode): CampaignDepositKind {
  return supportMode === "direct_creator" ? "simple_task_tip" : "campaign_deposit";
}

export function deriveCampaignSupportState(args: {
  campaignType: number;
  currentDeposits: bigint;
  description?: string | null;
}) {
  const supportMode = deriveCampaignSupportMode(args.campaignType);
  const supportEnabled = !hasNonTippableTag(args.description);

  return {
    supportEnabled,
    supportDisabledByTag: !supportEnabled,
    supportMode,
    depositKind: deriveCampaignDepositKind(supportMode),
    totalShannons: args.currentDeposits,
  };
}
