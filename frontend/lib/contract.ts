const FREIGHT_CONTRACT_CODE_HASH = "0xb3e70faf1c866aba4cff70b66e28140e05af70b3d0aa1d343286810ca900b869";
const FREIGHT_CONTRACT_HASH_TYPE = (process.env.NEXT_PUBLIC_FREIGHT_HASH_TYPE || "type") as "type" | "data" | "data1";
const FREIGHT_CONTRACT_OUTPOINT_TX_HASH = "0x17420dcef3ae1d307e46cfaedc6634fa04ca7cbffa8ba41e918f1913ff3daa08";
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
