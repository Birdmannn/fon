// ─── Deployed contract (CKB Testnet) ─────────────────────────────────────────
// Update CODE_HASH after each upgrade; OUT_POINT changes too.
// TYPE_ID (CODE_HASH) is stable across upgrades when hash_type = "type".

export const FREIGHT_CONTRACT = {
  codeHash:
    "0xc6294de6e84c5fdb8845e87b672d69cbc3f2074400f0c211817a9025db1ff16c",
  hashType: "type" as const,
  outPoint: {
    txHash:
      "0x38e46548928f1ae426c1b02610a7ea43d318bc446bceecfb1127f9f8bf65cf06",
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
