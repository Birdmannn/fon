const FREIGHT_CONTRACT_CODE_HASH = process.env.NEXT_PUBLIC_FREIGHT_CODE_HASH
  || "0x50257469fedf0fc38ea06f803f289a4a395f802b7cc59a03d00846c9e6e36f43";
const FREIGHT_CONTRACT_HASH_TYPE = (process.env.NEXT_PUBLIC_FREIGHT_HASH_TYPE || "type") as "type" | "data" | "data1";
const FREIGHT_CONTRACT_OUTPOINT_TX_HASH = process.env.NEXT_PUBLIC_FREIGHT_OUTPOINT_TX_HASH
  || "0x48c6a734b1ef27cf8f877f800911b1373587d61011269f697cd524d23df64ab5";
const FREIGHT_CONTRACT_OUTPOINT_INDEX = Number.parseInt(process.env.NEXT_PUBLIC_FREIGHT_OUTPOINT_INDEX || "0", 10);

// ─── Deployed contract (environment-configurable) ─────────────────────────────
export const FREIGHT_CONTRACT = {
  codeHash: FREIGHT_CONTRACT_CODE_HASH,
  hashType: FREIGHT_CONTRACT_HASH_TYPE,
  outPoint: {
    txHash: FREIGHT_CONTRACT_OUTPOINT_TX_HASH,
    index: Number.isFinite(FREIGHT_CONTRACT_OUTPOINT_INDEX) ? FREIGHT_CONTRACT_OUTPOINT_INDEX : 0,
  },
} as const;

// ─── Instruction selectors ────────────────────────────────────────────────────
export const Selector = {
  CreateCampaign: 0,
  Deposit: 1,
  BatchDeliver: 2,
  VerifyParticipant: 3,
  UpdateCampaignStatus: 4,
  SubmitRandomnessHash: 5,
  CancelCampaign: 6,
  Refund: 7,
  CreatorWithdraw: 8,
  DrawRecurringRaffle: 9,
  ClaimRecurringRaffle: 10,
  RolloverRecurringRaffle: 11,
  ReclaimRecurringParticipant: 12,
  ApproveCampaign: 13,
  ApproveRaffle: 13,
  ConfirmRaffleApproval: 14,
  ClaimGift: 15,
  StateLock: 255,
} as const;
export type Selector = (typeof Selector)[keyof typeof Selector];

// ─── On-chain enums ───────────────────────────────────────────────────────────
export const CampaignType = {
  SimpleTask: 0,
  FundedTask: 1,
  Crowdfunding: 2,
  TimedChallenge: 3,
  Raffle: 4,
  RecurringRaffle: 5,
} as const;
export type CampaignType = (typeof CampaignType)[keyof typeof CampaignType];

export const CampaignStatus = {
  Created: 0,
  Active: 1,
  Completed: 2,
  Cancelled: 3,
  Sleeping: 4,
  Finished: 5,
} as const;
export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];

export const ParticipantStatus = {
  Pending: 0,
  Verified: 1,
  Rewarded: 2,
  Refunded: 3,
  Winner: 4,
  Eliminated: 5,
} as const;
export type ParticipantStatus = (typeof ParticipantStatus)[keyof typeof ParticipantStatus];

// ─── Cell data sizes (must match Rust constants) ──────────────────────────────
export const LEGACY_CAMPAIGN_DATA_LEN = 174;
export const CAMPAIGN_DATA_LEN = 198;
export const RECURRING_CAMPAIGN_DATA_LEN = 254;
export const PARTICIPANT_DATA_LEN = 66;
export const RECURRING_PARTICIPANT_DATA_LEN = 82;
