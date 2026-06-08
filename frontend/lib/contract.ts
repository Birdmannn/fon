const FREIGHT_CONTRACT_CODE_HASH = "0xa5648953aae9cec2892ae9ac6d23d912905382c00955d02f14c691f92780864c";
const FREIGHT_CONTRACT_HASH_TYPE = (process.env.NEXT_PUBLIC_FREIGHT_HASH_TYPE || "type") as "type" | "data" | "data1";
const FREIGHT_CONTRACT_OUTPOINT_TX_HASH = "0xc9154573c5c70c6645f0c4b15a292a60ca3b7de65aafbfa48e61957428c39c51";
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
export enum Selector {
  CreateCampaign = 0,
  Deposit = 1,
  BatchDeliver = 2,
  VerifyParticipant = 3,
  UpdateCampaignStatus = 4,
  SubmitRandomnessHash = 5,
  CancelCampaign = 6,
  Refund = 7,
}

// ─── On-chain enums ───────────────────────────────────────────────────────────
export enum CampaignType {
  SimpleTask = 0,
  FundedTask = 1,
  Crowdfunding = 2,
  TimedChallenge = 3,
  Raffle = 4,
}

export enum CampaignStatus {
  Created = 0,
  Active = 1,
  Completed = 2,
  Cancelled = 3,
}

export enum ParticipantStatus {
  Pending = 0,
  Verified = 1,
  Rewarded = 2,
  Refunded = 3,
}

// ─── Cell data sizes (must match Rust constants) ──────────────────────────────
export const CAMPAIGN_DATA_LEN = 174;
export const PARTICIPANT_DATA_LEN = 73;
