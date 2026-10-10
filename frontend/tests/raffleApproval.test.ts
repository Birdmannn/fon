import assert from "node:assert/strict";
import test from "node:test";
import { CampaignStatus, CampaignType } from "../lib/contract.ts";
import { decodeCampaignData, encodeCampaignData, encodeCreateCampaignArgs, type CampaignData } from "../lib/encoding.ts";
import { assertRaffleApprovalAction, decodeRaffleApproval, encodeRaffleApproval, parseRaffleApprovalConfig, raffleApprovalDeadlineMissed, raffleApprovalsSatisfied, validateRaffleApproval, type RaffleApprovalState } from "../lib/raffleApproval.ts";
function approval(stage: "on-commence" | "on-delivery" = "on-commence"): RaffleApprovalState {
  return { stage, required: 2, confirmed: false, approvers: [1, 2].map((key) => ({ lockHash: new Uint8Array(32).fill(key), approved: false })) };
}
function campaign(gate: RaffleApprovalState | null = approval()): CampaignData {
  return { createdAt: 1000n, startDurationSecs: 60n, taskDurationSecs: 60n, createdBy: new Uint8Array(20), campaignType: CampaignType.Raffle,
    maximumAmount: 1000n, currentDeposits: 0n, status: CampaignStatus.Created, rewardCount: 1n, randomnessHash: new Uint8Array(32), summary: new Uint8Array(64), auxAmount: 100n,
    ticketSalesTotal: 0n, creatorSupportTotal: 0n, supportPoolBps: 0n, dataLayout: "split-support", approval: gate };
}
test("approval codec and campaign layouts preserve wallet identities and votes", () => {
  const gate = approval(); gate.approvers[0].approved = true;
  assert.deepEqual(decodeRaffleApproval(encodeRaffleApproval(gate)), gate);
  assert.deepEqual(decodeCampaignData(encodeCampaignData(campaign(gate))).approval, gate);
  const recurring = { ...campaign(gate), campaignType: CampaignType.RecurringRaffle, dataLayout: "recurring" as const, sleepDurationSecs: 60n, winnerReductionBps: 5000n, round: 1n, roundStartedAt: 61_000n, roundRewardPerWinner: 0n, roundWinnerCount: 0n, prizePool: 0n };
  assert.deepEqual(decodeCampaignData(encodeCampaignData(recurring)), recurring);
  assert.equal(encodeCampaignData(campaign(null)).length, 198);
  assert.equal(decodeCampaignData(encodeCampaignData(campaign(null))).approval, null);
});
test("creation preserves approval offsets for unlimited and recurring raffles", () => {
  const gate = approval();
  const args = encodeCreateCampaignArgs(60n,60n,CampaignType.Raffle,0n,100n,new Uint8Array(32),1n,0n,null,null,gate);
  assert.deepEqual(decodeRaffleApproval(args.slice(90)), gate);
  const recurring = encodeCreateCampaignArgs(60n,60n,CampaignType.RecurringRaffle,0n,100n,new Uint8Array(32),1n,0n,null,{ sleepDurationSecs: 60n, winnerReductionBps: 5000n },gate);
  assert.deepEqual(decodeRaffleApproval(recurring.slice(106)), gate);
});
test("commencement requires delay; recurring rejects delivery; delivery requires all", () => {
  assert.throws(() => validateRaffleApproval(approval(),CampaignType.Raffle,0n), /start delay/);
  assert.doesNotThrow(() => validateRaffleApproval(approval(),CampaignType.RecurringRaffle,60n));
  assert.throws(() => validateRaffleApproval(approval("on-delivery"),CampaignType.RecurringRaffle,60n), /initial commencement/);
  const delivery = approval("on-delivery"); delivery.required = 1;
  assert.throws(() => validateRaffleApproval(delivery,CampaignType.Raffle,0n), /all approvers/);
});
test("missing commencement threshold closes at deadline; cancellation permits recovery", () => {
  const freight = campaign();
  assert.equal(raffleApprovalDeadlineMissed(freight,60_999), false);
  assert.equal(raffleApprovalDeadlineMissed(freight,61_000), true);
  for (const action of ["approve","support","participate","distribute","withdraw"] as const) assert.throws(() => assertRaffleApprovalAction(freight,action,61_000), /deadline missed/);
  freight.status = CampaignStatus.Cancelled;
  assert.doesNotThrow(() => assertRaffleApprovalAction(freight,"withdraw",61_000));
});
test("commencement needs inclusion confirmation once, including for recurring raffles", () => {
  const gate = approval(); gate.approvers.forEach((entry) => { entry.approved = true; });
  assert.equal(raffleApprovalsSatisfied(gate), false);
  assert.throws(() => assertRaffleApprovalAction(campaign(gate),"participate",60_000), /Confirm/);
  gate.confirmed = true;
  assert.equal(raffleApprovalsSatisfied(gate), true);
  const freight = { ...campaign(gate), campaignType: CampaignType.RecurringRaffle, round: 3n, status: CampaignStatus.Active };
  assert.equal(raffleApprovalDeadlineMissed(freight,1_000_000), false);
  assert.doesNotThrow(() => assertRaffleApprovalAction(freight,"distribute",1_000_000));
});
test("delivery permits entry but blocks payout until all approvals", () => {
  const gate = approval("on-delivery"); gate.approvers[0].approved = true;
  assert.doesNotThrow(() => assertRaffleApprovalAction(campaign(gate),"participate",1_000_000));
  for (const action of ["distribute","withdraw"] as const) assert.throws(() => assertRaffleApprovalAction(campaign(gate),action,1_000_000), /All delivery approvals/);
  gate.approvers[1].approved = true;
  assert.doesNotThrow(() => assertRaffleApprovalAction(campaign(gate),"distribute",1_000_000));
});
test("malformed data, duplicate wallets, and invalid saved rules are rejected", () => {
  const gate = approval(); gate.approvers[1].lockHash = gate.approvers[0].lockHash;
  assert.throws(() => encodeRaffleApproval(gate), /distinct wallet/);
  assert.throws(() => decodeRaffleApproval(new Uint8Array([65,80,86,49])), /Invalid/);
  assert.throws(() => parseRaffleApprovalConfig({ stage:"on-delivery",required:1,approvers:[{ handle:"@alice",address:null },{ handle:"@bob",address:null }] }), /all approvers/);
  assert.equal(parseRaffleApprovalConfig(null), null);
});

test("a timely quorum remains confirmable after the deadline; a late receipt stays closed", () => {
  const gate = approval(); gate.approvers.forEach((entry) => { entry.approved = true; });
  gate.recordedAt = 60_999n;
  assert.equal(raffleApprovalDeadlineMissed(campaign(gate), 100_000), false);
  gate.recordedAt = 61_000n;
  assert.equal(raffleApprovalDeadlineMissed(campaign(gate), 100_000), true);
});
test("remaining commencement approvers cannot submit votes after the deadline", () => {
  const gate = approval(); gate.required = 1; gate.confirmed = true; gate.approvers[0].approved = true;
  assert.throws(() => assertRaffleApprovalAction(campaign(gate), "approve", 61_000), /deadline has passed/);
});
