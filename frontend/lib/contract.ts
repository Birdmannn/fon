const FREIGHT_CONTRACT_CODE_HASH = process.env.NEXT_PUBLIC_FREIGHT_CODE_HASH
  || "0x096c42bd796f70653b770c8b7a3a5c2ce687afd04147c9a80355427bd72023d2";
const FREIGHT_CONTRACT_HASH_TYPE = (process.env.NEXT_PUBLIC_FREIGHT_HASH_TYPE || "type") as "type" | "data" | "data1";
const FREIGHT_CONTRACT_OUTPOINT_TX_HASH = process.env.NEXT_PUBLIC_FREIGHT_OUTPOINT_TX_HASH
  || "0x04398a268497683896caa095fcc5b4eded4a48a9d7d14b8e16722f645918e883";
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
