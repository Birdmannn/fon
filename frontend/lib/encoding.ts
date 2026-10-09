import { decodeRaffleApproval, encodeRaffleApproval, type RaffleApprovalState } from "./raffleApproval.ts";
import type { ccc } from "@ckb-ccc/connector-react";
import {
  CAMPAIGN_DATA_LEN,
  CampaignStatus,
  CampaignType,
  LEGACY_CAMPAIGN_DATA_LEN,
  ParticipantStatus,
  RECURRING_CAMPAIGN_DATA_LEN,
  Selector,
} from "./contract.ts";
import {
  calculateCreatorWithdrawableSupport,
  calculateRaffleRewardPool,
  calculateRaffleSupportContribution,
} from "./raffleSupportPool.ts";

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
 *  Raffles with a finite ticket count append [tickets_per_user(8)].
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
  ticketsPerUser: bigint | null = null,
  recurring?: { sleepDurationSecs: bigint; winnerReductionBps: bigint } | null,
  approval?: RaffleApprovalState | null,
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
    ...(ticketsPerUser === null && !approval ? [] : [u64LE(approval?.stage === "gift-commence" ? 0n : ticketsPerUser ?? 1n)]),
    ...(recurring ? [u64LE(recurring.sleepDurationSecs), u64LE(recurring.winnerReductionBps)] : []),
    ...(approval ? [encodeRaffleApproval(approval)] : []),
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

export function encodeVerifyRaffleTicketCount(ticketCount: bigint): Uint8Array {
  return concat(new Uint8Array([Selector.VerifyParticipant]), u64LE(ticketCount));
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

export type CampaignDataLayout = "legacy" | "split-support" | "recurring";

// ─── Campaign cell data (174 or 198 bytes) ───────────────────────────────────

export interface CampaignData {
  approval?: RaffleApprovalState | null;
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
  sleepDurationSecs?: bigint;
  winnerReductionBps?: bigint;
  round?: bigint;
  roundStartedAt?: bigint;
  roundRewardPerWinner?: bigint;
  roundWinnerCount?: bigint;
  prizePool?: bigint;
}

export function hasSplitSupportAccounting(campaign: CampaignData) {
  return campaign.dataLayout !== "legacy";
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

  return calculateRaffleSupportContribution(campaign.creatorSupportTotal, campaign.supportPoolBps);
}

export function computeRaffleRewardPool(campaign: CampaignData) {
  if (campaign.campaignType === CampaignType.RecurringRaffle) {
    return campaign.prizePool ?? 0n;
  }
  if (campaign.campaignType !== CampaignType.Raffle || !hasSplitSupportAccounting(campaign)) {
    return campaign.currentDeposits;
  }

  return calculateRaffleRewardPool({
    ticketPrice: campaign.auxAmount,
    ticketSalesTotal: campaign.ticketSalesTotal,
    creatorSupportTotal: campaign.creatorSupportTotal,
    supportPoolBps: campaign.supportPoolBps,
  });
}

export function computeCreatorWithdrawableAmount(campaign: CampaignData) {
  if (campaign.campaignType === CampaignType.RecurringRaffle) {
    return campaign.status === CampaignStatus.Finished ? campaign.currentDeposits : 0n;
  }
  if (
    campaign.campaignType !== CampaignType.Raffle
    || !hasSplitSupportAccounting(campaign)
    || campaign.currentDeposits <= 0n
    || campaign.ticketSalesTotal !== 0n
    || campaign.creatorSupportTotal !== campaign.currentDeposits
  ) {
    return 0n;
  }

  return calculateCreatorWithdrawableSupport({
    currentDeposits: campaign.currentDeposits,
    ticketSalesTotal: campaign.ticketSalesTotal,
    creatorSupportTotal: campaign.creatorSupportTotal,
  });
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

  const splitSupport = concat(
    base,
    u64LE(c.ticketSalesTotal),
    u64LE(c.creatorSupportTotal),
    u64LE(c.supportPoolBps),
  );
  if (c.dataLayout !== "recurring") {
    return c.approval ? concat(splitSupport, encodeRaffleApproval(c.approval)) : splitSupport;
  }
  return concat(
    splitSupport,
    u64LE(c.sleepDurationSecs ?? 0n),
    u64LE(c.winnerReductionBps ?? 0n),
    u64LE(c.round ?? 1n),
    u64LE(c.roundStartedAt ?? c.createdAt + c.startDurationSecs * 1000n),
    u64LE(c.roundRewardPerWinner ?? 0n),
    u64LE(c.roundWinnerCount ?? 0n),
    u64LE(c.prizePool ?? 0n),
    ...(c.approval ? [encodeRaffleApproval(c.approval)] : []),
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

  const splitSupport = {
    ...base,
    ticketSalesTotal: view.getBigUint64(174, true),
    creatorSupportTotal: view.getBigUint64(182, true),
    supportPoolBps: view.getBigUint64(190, true),
    dataLayout: "split-support" as CampaignDataLayout,
  };
  if (data.length < RECURRING_CAMPAIGN_DATA_LEN || base.campaignType !== CampaignType.RecurringRaffle) {
    return { ...splitSupport, approval: decodeRaffleApproval(data.slice(CAMPAIGN_DATA_LEN)) };
  }
  return {
    ...splitSupport,
    dataLayout: "recurring",
    sleepDurationSecs: view.getBigUint64(198, true),
    winnerReductionBps: view.getBigUint64(206, true),
    round: view.getBigUint64(214, true),
    roundStartedAt: view.getBigUint64(222, true),
    roundRewardPerWinner: view.getBigUint64(230, true),
    roundWinnerCount: view.getBigUint64(238, true),
    prizePool: view.getBigUint64(246, true),
    approval: decodeRaffleApproval(data.slice(RECURRING_CAMPAIGN_DATA_LEN)),
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
  round?: bigint;
  claimableAmount?: bigint;
}

export function encodeParticipantData(p: ParticipantData): Uint8Array {
  const base = concat(
    p.campaignCreatedBy,
    u64LE(p.campaignCreatedAt),
    new Uint8Array([p.campaignType]),
    p.participantAddress,
    u64LE(p.joinedAt),
    new Uint8Array([p.status]),
    u64LE(p.depositedAmount),
  );
  if (p.campaignType !== CampaignType.RecurringRaffle) {
    return base;
  }
  return concat(base, u64LE(p.round ?? 1n), u64LE(p.claimableAmount ?? 0n));
}

export function decodeParticipantData(data: Uint8Array): ParticipantData {
  if (data.length < 66) throw new Error("participant data too short");
  const view = new DataView(data.buffer, data.byteOffset);
  const participant: ParticipantData = {
    campaignCreatedBy: data.slice(0, 20),
    campaignCreatedAt: view.getBigUint64(20, true),
    campaignType: data[28] as CampaignType,
    participantAddress: data.slice(29, 49),
    joinedAt: view.getBigUint64(49, true),
    status: data[57] as ParticipantStatus,
    depositedAmount: view.getBigUint64(58, true),
  };
  if (participant.campaignType === CampaignType.RecurringRaffle && data.length >= 82) {
    participant.round = view.getBigUint64(66, true);
    participant.claimableAmount = view.getBigUint64(74, true);
  }
  return participant;
}

export { u32LE };
