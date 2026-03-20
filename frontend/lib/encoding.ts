import { CampaignStatus, CampaignType, ParticipantStatus, Selector } from "./contract";

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

// ─── Script args encoding ─────────────────────────────────────────────────────

/** args for selector 0 – create_campaign
 *  [0x00][start_duration(8)][task_duration(8)][campaign_type(1)][maximum_amount(8)]
 */
export function encodeCreateCampaignArgs(
  startDurationSecs: bigint,
  taskDurationSecs: bigint,
  campaignType: CampaignType,
  maximumAmount: bigint
): Uint8Array {
  return concat(
    new Uint8Array([Selector.CreateCampaign]),
    u64LE(startDurationSecs),
    u64LE(taskDurationSecs),
    new Uint8Array([campaignType]),
    u64LE(maximumAmount)
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
  adminPubkey: Uint8Array
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
  randomnessHash: Uint8Array
): Uint8Array {
  if (randomnessHash.length !== 32) throw new Error("randomnessHash must be 32 bytes");
  return concat(
    new Uint8Array([Selector.SubmitRandomnessHash]),
    u64LE(rewardCount),
    randomnessHash
  );
}

// ─── Campaign cell data (102 bytes) ──────────────────────────────────────────

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
}

export function encodeCampaignData(c: CampaignData): Uint8Array {
  return concat(
    u64LE(c.createdAt),
    u64LE(c.startDurationSecs),
    u64LE(c.taskDurationSecs),
    c.createdBy,
    new Uint8Array([c.campaignType]),
    u64LE(c.maximumAmount),
    u64LE(c.currentDeposits),
    new Uint8Array([c.status]),
    u64LE(c.rewardCount),
    c.randomnessHash
  );
}

export function decodeCampaignData(data: Uint8Array): CampaignData {
  if (data.length < 102) throw new Error("campaign data too short");
  const view = new DataView(data.buffer, data.byteOffset);
  return {
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
  };
}

// ─── Participant cell data (65 bytes) ─────────────────────────────────────────

export interface ParticipantData {
  campaignTxHash: Uint8Array; // 32 bytes
  campaignIndex: number;
  participantAddress: Uint8Array; // 20 bytes
  joinedAt: bigint;
  status: ParticipantStatus;
}

export function encodeParticipantData(p: ParticipantData): Uint8Array {
  return concat(
    p.campaignTxHash,
    u32LE(p.campaignIndex),
    p.participantAddress,
    u64LE(p.joinedAt),
    new Uint8Array([p.status])
  );
}

export function decodeParticipantData(data: Uint8Array): ParticipantData {
  if (data.length < 65) throw new Error("participant data too short");
  const view = new DataView(data.buffer, data.byteOffset);
  return {
    campaignTxHash: data.slice(0, 32),
    campaignIndex: view.getUint32(32, true),
    participantAddress: data.slice(36, 56),
    joinedAt: view.getBigUint64(56, true),
    status: data[64] as ParticipantStatus,
  };
}
