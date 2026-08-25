import type { ccc } from "@ckb-ccc/connector-react";
import {
  CAMPAIGN_DATA_LEN,
  CampaignStatus,
  CampaignType,
  LEGACY_CAMPAIGN_DATA_LEN,
  ParticipantStatus,
  Selector,
} from "./contract";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function u64LE(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

function u32LE(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = value & 0xff;
  buf[1] = (value >> 8) & 0xff;
  buf[2] = (value >> 16) & 0xff;
  buf[3] = (value >> 24) & 0xff;
  return buf;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(len);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const arr = new Uint8Array(h.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

export function bytesToHex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function lockScriptToAddressBytes(lock: ccc.ScriptLike): Uint8Array {
  const lockArgs = typeof lock.args === "string" ? hexToBytes(lock.args) : hexToBytes(String(lock.args));
  if (lockArgs.length < 20) {
    throw new Error("Lock args too short to derive address bytes");
  }
  return lockArgs.slice(0, 20);
}

// ─── Script args encoding ─────────────────────────────────────────────────────

/** args for selector 0 – create_campaign
 *  [0x00][start_duration(8)][task_duration(8)][campaign_type(1)][maximum_amount(8)][aux_amount(8)][randomness_hash(32)][reward_count(8)][support_pool_bps(8)]
 */
export function encodeCreateCampaignArgs(
  startDurationSecs: bigint,
  taskDurationSecs: bigint,
  campaignType: CampaignType,
  maximumAmount: bigint,
  auxAmount: bigint,
  randomnessHash: Uint8Array,
  rewardCount: bigint,
  supportPoolBps: bigint,
): Uint8Array {
  if (randomnessHash.length !== 32) throw new Error("randomnessHash must be 32 bytes");
  return concat(
    new Uint8Array([Selector.CreateCampaign]),
    u64LE(startDurationSecs),
    u64LE(taskDurationSecs),
    new Uint8Array([campaignType]),
    u64LE(maximumAmount),
    u64LE(auxAmount),
    randomnessHash,
    u64LE(rewardCount),
    u64LE(supportPoolBps),
  );
}

/** args for selector 1 – deposit
 *  [0x01][amount(8)]
 */
export function encodeDepositArgs(amount: bigint): Uint8Array {
  return concat(new Uint8Array([Selector.Deposit]), u64LE(amount));
}

/** args for selector 2 – batch_deliver
 *  no randomness: [0x02]
 *  with randomness: [0x02][preimage(32)]
 */
export function encodeBatchDeliverArgs(preimage?: Uint8Array): Uint8Array {
  if (preimage) {
    if (preimage.length !== 32) throw new Error("preimage must be 32 bytes");
    return concat(new Uint8Array([Selector.BatchDeliver]), preimage);
  }
  return new Uint8Array([Selector.BatchDeliver]);
}

/** args for selector 3 – verify_participant
 *  [0x03][admin_address(20)][admin_pubkey(33)]
 */
export function encodeVerifyParticipantArgs(
  adminAddress: Uint8Array,
  adminPubkey: Uint8Array,
): Uint8Array {
  if (adminAddress.length !== 20) throw new Error("adminAddress must be 20 bytes");
  if (adminPubkey.length !== 33) throw new Error("adminPubkey must be 33 bytes (compressed)");
  return concat(new Uint8Array([Selector.VerifyParticipant]), adminAddress, adminPubkey);
}

/** args for selector 5 – submit_randomness_hash
 *  [0x05][reward_count(8)][randomness_hash(32)]
 */
export function encodeSubmitRandomnessHashArgs(
  rewardCount: bigint,
  randomnessHash: Uint8Array,
): Uint8Array {
  if (randomnessHash.length !== 32) throw new Error("randomnessHash must be 32 bytes");
  return concat(
    new Uint8Array([Selector.SubmitRandomnessHash]),
    u64LE(rewardCount),
    randomnessHash,
  );
}

export type CampaignDataLayout = "legacy" | "split-support";

// ─── Campaign cell data (174 or 198 bytes) ───────────────────────────────────

export interface CampaignData {
  createdAt: bigint;
  startDurationSecs: bigint;
  taskDurationSecs: bigint;
  createdBy: Uint8Array; // 20 bytes
  campaignType: CampaignType;
  maximumAmount: bigint;
  currentDeposits: bigint;
  status: CampaignStatus;
  rewardCount: bigint;
  randomnessHash: Uint8Array; // 32 bytes
  summary: Uint8Array; // 64 bytes, UTF-8 zero-padded
  auxAmount: bigint; // ticket_price for Raffle, 0 otherwise
  ticketSalesTotal: bigint;
  creatorSupportTotal: bigint;
  supportPoolBps: bigint;
  dataLayout: CampaignDataLayout;
}

export function hasSplitSupportAccounting(campaign: CampaignData) {
  return campaign.dataLayout === "split-support";
}

export function computeRaffleSupportPoolContribution(campaign: CampaignData) {
  if (
    campaign.campaignType !== CampaignType.Raffle
    || !hasSplitSupportAccounting(campaign)
    || campaign.creatorSupportTotal <= 0n
    || campaign.supportPoolBps <= 0n
  ) {
    return 0n;
  }

  return (campaign.creatorSupportTotal * campaign.supportPoolBps) / 10_000n;
}

export function computeRaffleRewardPool(campaign: CampaignData) {
  if (campaign.campaignType !== CampaignType.Raffle || !hasSplitSupportAccounting(campaign)) {
    return campaign.currentDeposits;
  }

  return campaign.ticketSalesTotal + computeRaffleSupportPoolContribution(campaign);
}

export function computeCreatorWithdrawableAmount(campaign: CampaignData) {
  if (
    campaign.campaignType !== CampaignType.Raffle
    || !hasSplitSupportAccounting(campaign)
    || campaign.currentDeposits <= 0n
    || campaign.ticketSalesTotal !== 0n
    || campaign.creatorSupportTotal !== campaign.currentDeposits
  ) {
    return 0n;
  }

  return campaign.creatorSupportTotal;
}

export function encodeSummary(text: string): Uint8Array {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length > 64) throw new Error("Summary exceeds 64 bytes");
  const buf = new Uint8Array(64);
  buf.set(encoded);
  return buf;
}

export function decodeSummary(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end === -1 ? bytes : bytes.slice(0, end));
}

export function encodeCampaignData(c: CampaignData): Uint8Array {
  const base = concat(
    u64LE(c.createdAt),
    u64LE(c.startDurationSecs),
    u64LE(c.taskDurationSecs),
    c.createdBy,
    new Uint8Array([c.campaignType]),
    u64LE(c.maximumAmount),
    u64LE(c.currentDeposits),
    new Uint8Array([c.status]),
    u64LE(c.rewardCount),
    c.randomnessHash,
    c.summary,
    u64LE(c.auxAmount),
  );

  if (c.dataLayout === "legacy") {
    return base;
  }

  return concat(
    base,
    u64LE(c.ticketSalesTotal),
    u64LE(c.creatorSupportTotal),
    u64LE(c.supportPoolBps),
  );
}

export function decodeCampaignData(data: Uint8Array): CampaignData {
  if (data.length < LEGACY_CAMPAIGN_DATA_LEN) throw new Error("campaign data too short");

  const view = new DataView(data.buffer, data.byteOffset);
  const base = {
    createdAt: view.getBigUint64(0, true),
    startDurationSecs: view.getBigUint64(8, true),
    taskDurationSecs: view.getBigUint64(16, true),
    createdBy: data.slice(24, 44),
    campaignType: data[44] as CampaignType,
    maximumAmount: view.getBigUint64(45, true),
    currentDeposits: view.getBigUint64(53, true),
    status: data[61] as CampaignStatus,
    rewardCount: view.getBigUint64(62, true),
    randomnessHash: data.slice(70, 102),
    summary: data.slice(102, 166),
    auxAmount: view.getBigUint64(166, true),
  };

  if (data.length < CAMPAIGN_DATA_LEN) {
    return {
      ...base,
      ticketSalesTotal: 0n,
      creatorSupportTotal: 0n,
      supportPoolBps: 0n,
      dataLayout: "legacy",
    };
  }

  return {
    ...base,
    ticketSalesTotal: view.getBigUint64(174, true),
    creatorSupportTotal: view.getBigUint64(182, true),
    supportPoolBps: view.getBigUint64(190, true),
    dataLayout: "split-support",
  };
}

// ─── Participant cell data (66 bytes) ─────────────────────────────────────────

export interface ParticipantData {
  campaignCreatedBy: Uint8Array; // 20 bytes
  campaignCreatedAt: bigint;
  campaignType: CampaignType;
  participantAddress: Uint8Array; // 20 bytes
  joinedAt: bigint;
  status: ParticipantStatus;
  depositedAmount: bigint; // shannons deposited by this participant
}

export function encodeParticipantData(p: ParticipantData): Uint8Array {
  return concat(
    p.campaignCreatedBy,
    u64LE(p.campaignCreatedAt),
    new Uint8Array([p.campaignType]),
    p.participantAddress,
    u64LE(p.joinedAt),
    new Uint8Array([p.status]),
    u64LE(p.depositedAmount),
  );
}

export function decodeParticipantData(data: Uint8Array): ParticipantData {
  if (data.length < 66) throw new Error("participant data too short");
  const view = new DataView(data.buffer, data.byteOffset);
  return {
    campaignCreatedBy: data.slice(0, 20),
    campaignCreatedAt: view.getBigUint64(20, true),
    campaignType: data[28] as CampaignType,
    participantAddress: data.slice(29, 49),
    joinedAt: view.getBigUint64(49, true),
    status: data[57] as ParticipantStatus,
    depositedAmount: view.getBigUint64(58, true),
  };
}

export { u32LE };
