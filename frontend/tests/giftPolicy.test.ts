import assert from "node:assert/strict";
import test from "node:test";
import { buildGiftPolicyConfig, encodeGiftPolicy, decodeGiftPolicy, assertGiftClaim, giftClaimSlot, validateGiftPolicy, type GiftPolicy } from "../lib/giftPolicy.ts";
import { createEmptyGiftDeliverable } from "../lib/giftDeliverables.ts";
import { encodeCampaignData, decodeCampaignData, encodeCreateCampaignArgs, type CampaignData } from "../lib/encoding.ts";
import { CampaignStatus, CampaignType } from "../lib/contract.ts";
const hash = (key: number) => new Uint8Array(32).fill(key);
const policy = (): GiftPolicy => ({ creator: hash(9), open: false, slots: [{ claimant: hash(1), amount: 100n, claimed: false }, { claimant: hash(2), amount: 200n, claimed: false }] });
function campaign(gift = policy()): CampaignData {
  return { createdAt:1000n,startDurationSecs:60n,taskDurationSecs:60n,createdBy:new Uint8Array(20),campaignType:CampaignType.FundedTask,
    maximumAmount:300n,currentDeposits:300n,status:CampaignStatus.Created,rewardCount:2n,randomnessHash:new Uint8Array(32),summary:new Uint8Array(64),auxAmount:0n,
    ticketSalesTotal:0n,creatorSupportTotal:0n,supportPoolBps:0n,dataLayout:"split-support",gift };
}
test("tagged equal/ratio allocations fix exact totals and give rounding remainder to the last claimant", () => {
  const gift = { ...createEmptyGiftDeliverable(),enabled:true,claimants:[{handle:"alice.ckb",address:"alice"},{handle:"bob.ckb",address:"bob"}],splitMode:"equal" as const };
  assert.deepEqual(buildGiftPolicyConfig(gift,301n,10n)?.slots.map((slot) => slot.amount),[150n,151n]);
  const ratio = { ...gift,splitMode:"ratio" as const,ratioEntries:[{handle:"alice",address:"alice",units:1},{handle:"bob",address:"bob",units:2}] };
  assert.deepEqual(buildGiftPolicyConfig(ratio,301n,10n)?.slots.map((slot) => slot.amount),[100n,201n]);
  assert.throws(() => buildGiftPolicyConfig({ ...gift,claimants:[{handle:"alice",address:null}] },300n,2n),/Resolve/);
  assert.throws(() => buildGiftPolicyConfig({ ...gift,receivers:[{handle:"stream",address:"x"}] },300n,2n),/@receive/);
});
test("open gifts have bounded slots and cannot use ratio splits", () => {
  const gift = { ...createEmptyGiftDeliverable(),enabled:true,splitMode:"equal" as const };
  const config = buildGiftPolicyConfig(gift,300n,3n)!;
  assert.equal(config.open,true); assert.deepEqual(config.slots.map((slot) => slot.amount),[100n,100n,100n]);
  assert.throws(() => buildGiftPolicyConfig(gift,300n,33n),/1–32/);
  assert.throws(() => buildGiftPolicyConfig({ ...gift,splitMode:"ratio" },300n,3n),/equal/);
});
test("campaign and creation codecs retain immutable gift rules with and without approvals", () => {
  const gift=policy();
  assert.deepEqual(decodeGiftPolicy(encodeGiftPolicy(gift)),gift);
  assert.deepEqual(decodeCampaignData(encodeCampaignData(campaign())).gift,gift);
  const approval = { stage:"gift-commence" as const,confirmed:false,required:1,approvers:[{lockHash:hash(3),approved:false}] };
  const c={...campaign(),approval};assert.deepEqual(decodeCampaignData(encodeCampaignData(c)).gift,gift);assert.deepEqual(decodeCampaignData(encodeCampaignData(c)).approval,approval);
  const args=encodeCreateCampaignArgs(60n,60n,CampaignType.FundedTask,300n,0n,new Uint8Array(32),2n,0n,null,null,null,gift);
  assert.equal(new DataView(args.buffer).getBigUint64(82,true),0n);
  assert.deepEqual(decodeGiftPolicy(args.slice(90)),gift);
});
test("claim selection uses full lock hashes, never mutable metadata or a different slot", () => {
  assert.equal(assertGiftClaim(campaign(),hash(1),61000n),0);
  assert.throws(() => assertGiftClaim(campaign(),hash(4),61000n),/no unclaimed/);
  const changed=policy();changed.slots[0].claimed=true;
  assert.equal(giftClaimSlot(changed,hash(1)),-1);
  const open={...policy(),open:true,slots:[{claimant:hash(1),amount:150n,claimed:true},{claimant:hash(0),amount:150n,claimed:false}]};
  assert.equal(giftClaimSlot(open,hash(1)),-1);assert.equal(giftClaimSlot(open,hash(2)),1);
});
test("claims require funding, approval and start time and reject legacy/cancelled gifts", () => {
  assert.throws(() => assertGiftClaim({...campaign(),gift:null},hash(1),61000n),/recreated/);
  assert.throws(() => assertGiftClaim(campaign(),hash(1),60999n),/start time/);
  assert.throws(() => assertGiftClaim({...campaign(),currentDeposits:299n},hash(1),61000n),/fully funded/);
  assert.throws(() => assertGiftClaim({...campaign(),status:CampaignStatus.Cancelled},hash(1),61000n),/closed/);
  assert.throws(() => assertGiftClaim({...campaign(),approval:{stage:"gift-commence",required:1,approvers:[{approved:false}]}},hash(1),61000n),/approvals/);
});
test("policies reject duplicates, invalid totals, initial preclaims, malformed bytes and integer overflow", () => {
  const p=policy();assert.throws(() => validateGiftPolicy(p,301n,2n,true),/equal/);
  assert.throws(() => encodeGiftPolicy({...p,slots:[p.slots[0],p.slots[0]]}),/allocation/);
  assert.throws(() => validateGiftPolicy({...p,slots:[{...p.slots[0],claimed:true},p.slots[1]]},300n,2n,true),/allocation/);
  const bytes=encodeGiftPolicy(p);bytes[78]=2;assert.throws(() => decodeGiftPolicy(bytes),/flag/);
  assert.throws(() => encodeGiftPolicy({...p,slots:[{...p.slots[0],amount:1n<<64n}]}),/allocation/);
});
