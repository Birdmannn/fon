// ─── Deployed contract (CKB Testnet) ─────────────────────────────────────────
export const FREIGHT_CONTRACT = {
  codeHash:
    "0xec267d9dea748406b4fcba135eef140d5ab0fa3a62214e08af4e30ec2033533a",
  hashType: "type" as const,
  outPoint: {
    txHash:
      "0x8cd7529e7a15ef5f9da1253d1e35d95bf023b1e70d548211623bd7fae128967e",
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
