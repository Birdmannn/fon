import { CampaignStatus, CampaignType } from "./contract.ts";
import { normalizeGiftHandle, type GiftDeliverable } from "./giftDeliverables.ts";

export type GiftSlot = { claimant: Uint8Array; amount: bigint; claimed: boolean };
export type GiftPolicy = { creator: Uint8Array; open: boolean; slots: GiftSlot[] };
export type GiftPolicyConfig = { open: boolean; slots: { claimantAddress: string | null; amount: bigint }[] };
const zero = (hash: Uint8Array) => hash.every((byte) => byte === 0);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);
const U64_MAX = (1n << 64n) - 1n;

export function buildGiftPolicyConfig(gift: GiftDeliverable, maximumAmount: bigint, rewardCount: bigint): GiftPolicyConfig | null {
  if (!gift.enabled) return null;
  if (maximumAmount <= 0n || maximumAmount > U64_MAX) throw new Error("Gift amount must fit a positive u64");
  if (gift.receivers.length) throw new Error("@receive payment streaming is not available. Use @claim for gifts.");
  const users = gift.claimants;
  const open = users.length === 0;
  const count = open ? Number(rewardCount) : users.length;
  if (!Number.isSafeInteger(count) || count < 1 || count > 32) throw new Error("Gifts support 1–32 allocations");
  const units = gift.splitMode === "ratio" ? users.map((user) => {
    const entry = gift.ratioEntries.find((ratio) => normalizeGiftHandle(ratio.handle) === normalizeGiftHandle(user.handle));
    if (!entry || !Number.isSafeInteger(entry.units) || entry.units <= 0) throw new Error("Add positive ratio units for each recipient");
    return BigInt(entry.units);
  }) : Array.from({ length: count }, () => 1n);
  if (open && gift.splitMode === "ratio") throw new Error("Open gifts use equal allocations");
  const totalUnits = units.reduce((total, value) => total + value, 0n);
  let remaining = maximumAmount;
  const slots = units.map((unit, index) => {
    const amount = index === count - 1 ? remaining : maximumAmount * unit / totalUnits;
    remaining -= amount;
    if (amount <= 0n) throw new Error("Each gift allocation must be greater than zero");
    const user = users[index];
    if (!open && !user?.address) throw new Error(`Resolve ${user?.handle ?? "the claimant"}'s wallet before publishing`);
    return { claimantAddress: user?.address ?? null, amount };
  });
  return { open, slots };
}

export function validateGiftPolicy(policy: GiftPolicy, maximumAmount?: bigint, rewardCount?: bigint, initial = false) {
  if (policy.creator.length !== 32 || zero(policy.creator) || !policy.slots.length || policy.slots.length > 32 || rewardCount !== undefined && rewardCount !== BigInt(policy.slots.length)) throw new Error("Invalid gift slot count");
  let total = 0n;
  policy.slots.forEach((slot, index) => {
    if (slot.claimant.length !== 32 || slot.amount <= 0n || slot.amount > U64_MAX
      || initial && slot.claimed || !policy.open && zero(slot.claimant)
      || policy.open && slot.claimed === zero(slot.claimant)
      || !zero(slot.claimant) && policy.slots.slice(0, index).some((entry) => same(entry.claimant, slot.claimant))) throw new Error("Invalid gift allocation");
    total += slot.amount;
  });
  if (total > U64_MAX || maximumAmount !== undefined && total !== maximumAmount) throw new Error("Gift allocations must equal the gift amount");
  if (policy.open) {
    const equal = total / BigInt(policy.slots.length);
    policy.slots.forEach((slot, index) => {
      const expected = index === policy.slots.length - 1 ? total - equal * BigInt(index) : equal;
      if (slot.amount !== expected) throw new Error("Open gifts require equal allocations");
    });
  }
}

export function encodeGiftPolicy(policy: GiftPolicy): Uint8Array {
  validateGiftPolicy(policy);
  const bytes = new Uint8Array(38 + 41 * policy.slots.length);
  bytes.set([71, 70, 84, 49, Number(policy.open), policy.slots.length]);
  bytes.set(policy.creator, 6);
  policy.slots.forEach((slot, index) => {
    const offset = 38 + 41 * index;
    bytes.set(slot.claimant, offset);
    new DataView(bytes.buffer).setBigUint64(offset + 32, slot.amount, true);
    bytes[offset + 40] = Number(slot.claimed);
  });
  return bytes;
}

export function decodeGiftPolicy(bytes: Uint8Array): GiftPolicy | null {
  if (!bytes.length) return null;
  if (bytes.length < 38 || ![71,70,84,49].every((value, index) => bytes[index] === value) || bytes[4] > 1 || !bytes[5] || bytes[5] > 32 || bytes.length !== 38 + 41 * bytes[5]) throw new Error("Invalid gift policy encoding");
  const slots = Array.from({ length: bytes[5] }, (_, index) => {
    const offset = 38 + 41 * index;
    if (bytes[offset + 40] > 1) throw new Error("Invalid gift claim flag");
    return { claimant: bytes.slice(offset, offset + 32), amount: new DataView(bytes.buffer, bytes.byteOffset).getBigUint64(offset + 32, true), claimed: bytes[offset + 40] === 1 };
  });
  const policy = { creator: bytes.slice(6, 38), open: bytes[4] === 1, slots };
  validateGiftPolicy(policy);
  return policy;
}

export function giftClaimSlot(policy: GiftPolicy, walletHash: Uint8Array): number {
  if (walletHash.length !== 32 || zero(walletHash) || policy.slots.some((slot) => slot.claimed && same(slot.claimant, walletHash))) return -1;
  return policy.slots.findIndex((slot) => !slot.claimed && (policy.open || same(slot.claimant, walletHash)));
}

export function assertGiftClaim(campaign: { campaignType: number; gift?: GiftPolicy | null; approval?: { stage: string; required: number; approvers: { approved: boolean }[] } | null; status: number; createdAt: bigint; startDurationSecs: bigint; currentDeposits: bigint; maximumAmount: bigint }, walletHash: Uint8Array, nowMs: bigint) {
  if (campaign.campaignType !== CampaignType.FundedTask || !campaign.gift) throw new Error("This older gift must be recreated with on-chain claim rules");
  if (![CampaignStatus.Created, CampaignStatus.Active].includes(campaign.status as 0 | 1)) throw new Error("This gift is closed");
  if (campaign.approval && (campaign.approval.stage !== "gift-commence" || campaign.approval.approvers.filter((entry) => entry.approved).length < campaign.approval.required)) throw new Error("Gift approvals are still pending");
  if (nowMs < campaign.createdAt + campaign.startDurationSecs * 1000n) throw new Error("Gift start time has not been reached");
  if (!campaign.gift.slots.some((slot) => slot.claimed) && campaign.currentDeposits < campaign.maximumAmount) throw new Error("Gift must be fully funded before claiming");
  const index = giftClaimSlot(campaign.gift, walletHash);
  if (index < 0) throw new Error("This wallet has no unclaimed gift allocation");
  if (campaign.currentDeposits < campaign.gift.slots[index].amount) throw new Error("Gift allocation is not funded");
  return index;
}
