// ─── Deployed contract (CKB Testnet) ─────────────────────────────────────────
// Update CODE_HASH after each upgrade; OUT_POINT changes too.
// TYPE_ID (CODE_HASH) is stable across upgrades when hash_type = "type".

export const FREIGHT_CONTRACT = {
  codeHash:
    "0xec267d9dea748406b4fcba135eef140d5ab0fa3a62214e08af4e30ec2033533a",
  hashType: "type" as const,
  outPoint: {
    txHash:
      "0x62010d354f67f456aee68012ad79ccbff0f65ea257cbb5d88672e96ffc85a60b",
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
}

// ─── On-chain enums ───────────────────────────────────────────────────────────
export enum CampaignType {
  SimpleTask = 0,
  FundedTask = 1,
  Crowdfunding = 2,
  TimedChallenge = 3,
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
}

// ─── Cell data sizes (must match Rust constants) ──────────────────────────────
export const CAMPAIGN_DATA_LEN = 102;
export const PARTICIPANT_DATA_LEN = 65;
