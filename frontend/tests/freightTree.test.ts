import assert from "node:assert/strict";
import test from "node:test";

import { ancestorIds, canEncroach, countDirectChildren, effectiveParticipantStatus, hasParticipantCreatedLinkedFreight, parentIds, sharesDirectChild, wouldCreateCycle } from "../lib/freightTree.ts";

test("counts only immediate children of the current freight", () => {
  const nodes = [
    { parentCampaignId: null },
    { parentCampaignId: "ROOT" },
    { parentCampaignId: "root" },
    { parentCampaignId: "child" },
    { parentCampaignIds: ["root", "other"] },
  ];
  assert.equal(countDirectChildren("root", nodes), 3);
  assert.equal(countDirectChildren("child", nodes), 1);
});

test("multiple parents are distinct and all ancestors are traversed", () => {
  const records = new Map([
    ["a", { campaignId: "a" }],
    ["b", { campaignId: "b" }],
    ["c", { campaignId: "c", parentCampaignIds: ["A", "b", "a"] }],
  ]);
  const getRecord = (id: string) => records.get(id) ?? null;
  assert.deepEqual(parentIds(records.get("c")), ["a", "b"]);
  assert.deepEqual(ancestorIds("c", getRecord), ["a", "b"]);
  assert.equal(wouldCreateCycle("a", "c", getRecord), true);
  assert.equal(wouldCreateCycle("b", "a", getRecord), false);
  assert.equal(sharesDirectChild("a", "b", [...records.values()]), true);
});

test("encroachment requires ten times the creator's current FBARS", () => {
  assert.equal(canEncroach(99, 10), false);
  assert.equal(canEncroach(100, 10), true);
  assert.equal(canEncroach(-1, 10), false);
});

test("parent relations reject cycles and resolve the whole ancestor chain", () => {
  const records = new Map([
    ["head", { campaignId: "head", parentCampaignId: null }],
    ["middle", { campaignId: "middle", parentCampaignId: "head" }],
    ["leaf", { campaignId: "leaf", parentCampaignId: "middle" }],
  ]);
  const getRecord = (id: string) => records.get(id) ?? null;
  assert.deepEqual(ancestorIds("leaf", getRecord), ["middle", "head"]);
  assert.equal(wouldCreateCycle("head", "leaf", getRecord), true);
  assert.equal(wouldCreateCycle("leaf", "head", getRecord), false);
});

test("a newly added incomplete head makes every descendant incomplete", () => {
  assert.equal(effectiveParticipantStatus(true, [true, true]), "verified");
  assert.equal(effectiveParticipantStatus(true, [true, false]), "pending");
  assert.equal(effectiveParticipantStatus(false, [true, true]), "pending");
});

test("a required linked freight must have been created by that participant", () => {
  assert.equal(hasParticipantCreatedLinkedFreight("ckt1participant", [{ creatorAddress: "CKT1PARTICIPANT" }]), true);
  assert.equal(hasParticipantCreatedLinkedFreight("ckt1other", [{ creatorAddress: "ckt1participant" }]), false);
  assert.equal(hasParticipantCreatedLinkedFreight("ckt1participant", []), false);
});
