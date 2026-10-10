import assert from "node:assert/strict";
import test from "node:test";
import { CampaignStatus, CampaignType } from "../lib/contract.ts";
import { encodeCampaignData, decodeCampaignData, encodeCreateCampaignArgs, type CampaignData } from "../lib/encoding.ts";
import { buildGiftApprovalConfig, isOnChainGiftApprovalSatisfied, isOnChainGiftClaimOpen } from "../lib/giftApproval.ts";
import { createEmptyGiftDeliverable } from "../lib/giftDeliverables.ts";
import { assertRaffleApprovalAction, validateCampaignApproval, type RaffleApprovalState } from "../lib/raffleApproval.ts";

function gift() {
  return { ...createEmptyGiftDeliverable(), enabled: true, approvers: [{ handle: "@alice", address: "ckt1alice" }, { handle: "@bob", address: "ckt1bob" }], approvalRule: { mode: "all" as const, threshold: null } };
}
function approval(required = 2): RaffleApprovalState {
  return { stage: "gift-commence", required, confirmed: false, approvers: [1, 2].map((key) => ({ lockHash: new Uint8Array(32).fill(key), approved: false })) };
}
function campaign(gate: RaffleApprovalState | null = approval()): CampaignData {
  return { createdAt: 1000n, startDurationSecs: 60n, taskDurationSecs: 60n, createdBy: new Uint8Array(20), campaignType: CampaignType.FundedTask,
    maximumAmount: 1000n, currentDeposits: 0n, status: CampaignStatus.Created, rewardCount: 1n, randomnessHash: new Uint8Array(32), summary: new Uint8Array(64), auxAmount: 0n,
    ticketSalesTotal: 0n, creatorSupportTotal: 0n, supportPoolBps: 0n, dataLayout: "split-support", approval: gate };
}
test("gift configuration preserves all and threshold approval rules", () => {
  assert.equal(buildGiftApprovalConfig(gift())?.required, 2);
  const threshold = { ...gift(), approvalRule: { mode: "threshold" as const, threshold: 1 } };
  assert.equal(buildGiftApprovalConfig(threshold)?.required, 1);
  assert.equal(buildGiftApprovalConfig(createEmptyGiftDeliverable()), null);
});
test("gift approval encoding reserves zero in the ticket slot and round-trips", () => {
  const gate = approval(1);
  assert.deepEqual(decodeCampaignData(encodeCampaignData(campaign(gate))).approval, gate);
  const args = encodeCreateCampaignArgs(0n,60n,CampaignType.FundedTask,1000n,0n,new Uint8Array(32),1n,0n,null,null,gate);
  assert.equal(new DataView(args.buffer).getBigUint64(82,true), 0n);
  assert.equal(args[94], 3);
  assert.doesNotThrow(() => validateCampaignApproval(gate,CampaignType.FundedTask,0n));
  assert.throws(() => validateCampaignApproval(gate,CampaignType.Raffle,60n), /Invalid approval stage/);
});
test("Mongo approvals cannot unlock a gift; only the immutable chain threshold counts", () => {
  const forged = { ...gift(), approvals: [{ address: "ckt1alice", handle: "@alice", approvedAt: new Date().toISOString() }, { address: "ckt1bob", handle: "@bob", approvedAt: new Date().toISOString() }] };
  const gate = approval();
  assert.equal(isOnChainGiftApprovalSatisfied(forged,gate), false);
  assert.equal(isOnChainGiftApprovalSatisfied(forged,null), false);
  gate.approvers[0].approved = true;
  assert.equal(isOnChainGiftApprovalSatisfied(forged,gate), false);
  gate.approvers[1].approved = true;
  assert.equal(isOnChainGiftApprovalSatisfied(forged,gate), true);
});
test("gifts support late approval and need no raffle confirmation transaction", () => {
  const gate = approval(1); gate.approvers[0].approved = true;
  assert.equal(isOnChainGiftApprovalSatisfied(gift(),gate), true);
  assert.doesNotThrow(() => assertRaffleApprovalAction(campaign(gate),"approve",100_000));
  assert.doesNotThrow(() => assertRaffleApprovalAction(campaign(gate),"distribute",100_000));
});
test("claims require chain quorum and the start time even if metadata approvers are removed", () => {
  const gate = approval(1);
  const fundedGift = () => ({ ...campaign(gate), currentDeposits: 1000n, gift: { creator: new Uint8Array(32).fill(7), open: true, slots: [{ claimant: new Uint8Array(32), amount: 1000n, claimed: false }] } });
  assert.equal(isOnChainGiftClaimOpen(fundedGift(),gift(),100_000),false);
  assert.equal(isOnChainGiftClaimOpen(fundedGift(),{ ...gift(),approvers:[] },100_000),false);
  gate.approvers[0].approved = true;
  assert.equal(isOnChainGiftClaimOpen(fundedGift(),gift(),60_999),false);
  assert.equal(isOnChainGiftClaimOpen(fundedGift(),gift(),61_000),true);
  const cancelled = { ...fundedGift(),status:CampaignStatus.Cancelled };
  assert.equal(isOnChainGiftClaimOpen(cancelled,gift(),100_000),false);
});
test("pending gifts allow funding but block commencement, distribution and withdrawal", () => {
  assert.doesNotThrow(() => assertRaffleApprovalAction(campaign(),"support",100_000));
  for (const action of ["participate","distribute","withdraw"] as const) assert.throws(() => assertRaffleApprovalAction(campaign(),action,100_000), /Gift commencement approvals/);
  assert.doesNotThrow(() => assertRaffleApprovalAction({ ...campaign(),status:CampaignStatus.Cancelled },"withdraw",100_000));
});

test("gift approval checks do not block raffle withdrawal controls", () => {
  const gate = { ...approval(),stage:"on-commence" as const };
  assert.equal(isOnChainGiftApprovalSatisfied(createEmptyGiftDeliverable(),gate),true);
  assert.equal(isOnChainGiftApprovalSatisfied(gift(),gate),false);
});
