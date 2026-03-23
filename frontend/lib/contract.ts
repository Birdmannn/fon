// ─── Deployed contract (CKB Testnet) ─────────────────────────────────────────
// Update CODE_HASH after each upgrade; OUT_POINT changes too.
// TYPE_ID (CODE_HASH) is stable across upgrades when hash_type = "type".

export const FREIGHT_CONTRACT = {
  codeHash:
    "0x4d4d1f8add25fdfbe9ef5b588d0319d8a18ef0b4814882f83de6305f5b89f31a",
  hashType: "type" as const,
  outPoint: {
    txHash:
      "0xb893f0d342fce1f29a0d093a517112e65801a1f4380a759ec843aeb0e72bb5b7",
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
