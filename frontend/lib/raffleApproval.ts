import { CampaignStatus, CampaignType } from "./contract.ts";

export type RaffleApprovalStage = "on-commence" | "on-delivery";
export type CampaignApprovalStage = RaffleApprovalStage | "gift-commence";
export type CampaignApprovalConfig = {
  stage: CampaignApprovalStage;
  required: number;
  approvers: Array<{ handle: string; address: string | null }>;
};
export type RaffleApprovalConfig = {
  stage: RaffleApprovalStage;
  required: number;
  approvers: Array<{ handle: string; address: string | null }>;
};
export type RaffleApprovalState = {
  // Read from the chain receipt; not serialized into campaign data.
  recordedAt?: bigint;
  confirmed: boolean;
  stage: CampaignApprovalStage;
  required: number;
  approvers: Array<{ lockHash: Uint8Array; approved: boolean }>;
};

export function parseRaffleApprovalConfig(value: unknown): RaffleApprovalConfig | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<RaffleApprovalConfig>;
  if (data.stage !== "on-commence" && data.stage !== "on-delivery") throw new Error("Choose an approval stage");
  if (!Array.isArray(data.approvers) || data.approvers.length < 1 || data.approvers.length > 32) throw new Error("Choose between 1 and 32 approvers");
  if (!Number.isInteger(data.required) || data.required! < 1 || data.required! > data.approvers.length) throw new Error("Invalid approval threshold");
  if (data.stage === "on-delivery" && data.required !== data.approvers.length) throw new Error("Delivery requires all approvers");
  const approvers = data.approvers.map((entry) => {
    if (!entry || typeof entry.handle !== "string" || !entry.handle.trim()) throw new Error("Invalid approver handle");
    return { handle: entry.handle.trim(), address: typeof entry.address === "string" && entry.address.trim() ? entry.address.trim() : null };
  });
  if (new Set(approvers.map((entry) => entry.handle.toLowerCase())).size !== approvers.length) throw new Error("Duplicate approvers");
  return { stage: data.stage, required: data.required!, approvers };
}

export function validateCampaignApproval(config: CampaignApprovalConfig | RaffleApprovalState, campaignType: number, startDelay: bigint) {
  if (campaignType === CampaignType.FundedTask) {
    if (config.stage !== "gift-commence") throw new Error("Gifts require a gift commencement approval gate");
  } else {
    if (campaignType !== CampaignType.Raffle && campaignType !== CampaignType.RecurringRaffle || config.stage === "gift-commence") throw new Error("Invalid approval stage for this freight type");
  }
  if (config.stage === "on-commence" && startDelay <= 0n) throw new Error("On-commence approval requires a start delay greater than zero");
  if (campaignType === CampaignType.RecurringRaffle && config.stage !== "on-commence") throw new Error("Recurring raffles only support initial commencement approval");
  if (config.approvers.length < 1 || config.approvers.length > 32 || !Number.isInteger(config.required) || config.required < 1 || config.required > config.approvers.length) throw new Error("Invalid approval threshold");
  if (config.stage === "on-delivery" && config.required !== config.approvers.length) throw new Error("Delivery requires all approvers");
}

export function validateRaffleApproval(config: RaffleApprovalConfig | RaffleApprovalState, campaignType: number, startDelay: bigint) {
  if (campaignType !== CampaignType.Raffle && campaignType !== CampaignType.RecurringRaffle) throw new Error("Approval gates are only supported on raffles");
  validateCampaignApproval(config, campaignType, startDelay);
}

export function raffleApprovalsSatisfied(approval?: RaffleApprovalState | null) {
  return !approval || ((approval.stage !== "on-commence" || approval.confirmed) && raffleApprovalThresholdMet(approval));
}

export function raffleApprovalThresholdMet(approval: RaffleApprovalState) {
  return approval.approvers.filter((entry) => entry.approved).length >= approval.required;
}

export function raffleApprovalDeadlineMissed(campaign: { createdAt: bigint; startDurationSecs: bigint; approval?: RaffleApprovalState | null }, nowMs = Date.now()) {
  const approval = campaign.approval;
  const deadline = campaign.createdAt + campaign.startDurationSecs * 1000n;
  return approval?.stage === "on-commence" && !approval.confirmed && BigInt(Math.trunc(nowMs)) >= deadline
    && (!raffleApprovalThresholdMet(approval) || (approval.recordedAt !== undefined && approval.recordedAt >= deadline));
}

export function assertRaffleApprovalAction(campaign: { createdAt: bigint; startDurationSecs: bigint; status: number; approval?: RaffleApprovalState | null }, action: "approve" | "participate" | "distribute" | "support" | "withdraw", nowMs = Date.now()) {
  if (raffleApprovalDeadlineMissed(campaign, nowMs) && !(action === "withdraw" && campaign.status === CampaignStatus.Cancelled)) throw new Error("Commencement approval deadline missed. Only cancellation is available.");
  if (campaign.status === CampaignStatus.Cancelled && action !== "withdraw") throw new Error("This freight is cancelled");
  if (action === "approve" && campaign.approval?.stage === "on-commence" && BigInt(Math.trunc(nowMs)) >= campaign.createdAt + campaign.startDurationSecs * 1000n) throw new Error("The commencement approval deadline has passed");
  if (campaign.approval?.stage === "on-commence" && raffleApprovalThresholdMet(campaign.approval) && !campaign.approval.confirmed && campaign.status !== CampaignStatus.Cancelled) throw new Error("Confirm the recorded commencement approvals first");
  if (!raffleApprovalsSatisfied(campaign.approval)) {
    if (campaign.approval?.stage === "gift-commence" && ["participate", "distribute", "withdraw"].includes(action) && campaign.status !== CampaignStatus.Cancelled) throw new Error("Gift commencement approvals are still pending");
    if (campaign.approval?.stage === "on-commence" && (action === "participate" || action === "distribute" || action === "support")) throw new Error("Commencement approvals are still pending");
    if (campaign.approval?.stage === "on-delivery" && (action === "distribute" || action === "withdraw") && campaign.status !== CampaignStatus.Cancelled) throw new Error("All delivery approvals are required before distribution");
  }
}

const MAGIC = [65, 80, 86, 49];
export function encodeRaffleApproval(approval: RaffleApprovalState): Uint8Array {
  if (approval.approvers.length < 1 || approval.approvers.length > 32) throw new Error("Invalid approver count");
  if (!Number.isInteger(approval.required) || approval.required < 1 || approval.required > approval.approvers.length || !["on-commence", "on-delivery", "gift-commence"].includes(approval.stage) || (approval.stage === "on-delivery" && approval.required !== approval.approvers.length)) throw new Error("Invalid approval rule");
  const bytes = new Uint8Array(8 + approval.approvers.length * 33);
  bytes.set(MAGIC);
  bytes[4] = approval.stage === "on-commence" ? 1 : approval.stage === "on-delivery" ? 2 : 3;
  bytes[5] = approval.required;
  bytes[6] = approval.approvers.length;
  bytes[7] = approval.confirmed ? 1 : 0;
  const seen = new Set<string>();
  approval.approvers.forEach((entry, index) => {
    const identity = Array.from(entry.lockHash).join(",");
    if (entry.lockHash.length !== 32 || entry.lockHash.every((byte) => byte === 0) || seen.has(identity)) throw new Error("Approvers must have distinct wallet locks");
    seen.add(identity);
    bytes.set(entry.lockHash, 8 + index * 33);
    bytes[40 + index * 33] = entry.approved ? 1 : 0;
  });
  return bytes;
}

export function decodeRaffleApproval(bytes: Uint8Array): RaffleApprovalState | null {
  if (!bytes.length) return null;
  if (bytes.length < 8 || !MAGIC.every((byte, index) => bytes[index] === byte) || ![1, 2, 3].includes(bytes[4]) || bytes[6] < 1 || bytes[6] > 32 || bytes.length !== 8 + bytes[6] * 33 || bytes[7] > 1 || bytes[5] < 1 || bytes[5] > bytes[6]) throw new Error("Invalid raffle approval data");
  const approval: RaffleApprovalState = {
    stage: bytes[4] === 1 ? "on-commence" : bytes[4] === 2 ? "on-delivery" : "gift-commence",
    required: bytes[5],
    confirmed: bytes[7] === 1,
    approvers: Array.from({ length: bytes[6] }, (_, index) => {
      if (bytes[40 + index * 33] > 1) throw new Error("Invalid approval flag");
      return { lockHash: bytes.slice(8 + index * 33, 40 + index * 33), approved: bytes[40 + index * 33] === 1 };
    }),
  };
  encodeRaffleApproval(approval);
  return approval;
}
