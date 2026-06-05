// ─── Deployed contract (CKB Testnet) ─────────────────────────────────────────
export const FREIGHT_CONTRACT = {
  codeHash:
    "0x262009f7daa271428b37e0b804451fb389deb23f1d146ad9a0356a93bcf0edfe",
  hashType: "type" as const,
  outPoint: {
    txHash:
      "0xefe7f8dca3d1e2621eca414162c52e36f48dd8a034a4bf9ad5d6bd5561f44d4d",
    index: 0,
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
