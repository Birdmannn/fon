import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, {alias: {"@": process.cwd()}});
const {campaignCreatorAddress, withCampaignCreatorIdentity} = jiti("../lib/campaignCreatorIdentity.ts") as typeof import("../lib/campaignCreatorIdentity.ts");
const record = {creatorAddress: "ckt1-pilot-session", creatorHandle: "wrong.ckb", campaignId: "0x123:1234:4", txHash: "0xabc", title: "My freight"};
const publication = {eventKey: "freight-create:0xabc", address: "ckt1-owner", metadata: {campaignId: record.campaignId}};

test("published Pilot freight displays the verified owner profile instead of the stored session identity", () => {
  const corrected = withCampaignCreatorIdentity(record, [publication], [{address: "ckt1-owner", username: "Bird"}]);
  assert.equal(corrected.creatorAddress, "ckt1-owner");
  assert.equal(corrected.creatorHandle, "Bird.ckb");
  assert.equal(corrected.campaignId, record.campaignId);
  assert.equal(corrected.txHash, record.txHash);
  assert.equal(record.creatorAddress, "ckt1-pilot-session", "reading never rewrites stored transaction identity");
});

test("creator recovery requires both this publication transaction and this campaign identity", () => {
  assert.equal(campaignCreatorAddress(record, [{...publication, eventKey: "freight-create:0xother"}]), record.creatorAddress);
  assert.equal(campaignCreatorAddress(record, [{...publication, metadata: {campaignId: "0xother:1234:4"}}]), record.creatorAddress);
  const legacy = {...record, campaignId: null, createdByHash: "0x123", chainCreatedAt: "1234", campaignType: 4};
  assert.equal(campaignCreatorAddress(legacy, [publication]), "ckt1-owner");
});

test("owner correction never reuses the session's username when the owner profile is unavailable", () => {
  const corrected = withCampaignCreatorIdentity(record, [publication], []);
  assert.equal(corrected.creatorAddress, "ckt1-owner");
  assert.notEqual(corrected.creatorHandle, "wrong.ckb");
});

test("JoyID identity stays unchanged and creator handles track the existing profile username", () => {
  const joy = {...record, creatorAddress: "ckt1-joyid", creatorHandle: "old.ckb"};
  const updated = withCampaignCreatorIdentity(joy, [], [{address: "ckt1-joyid", username: "NewName.ckb"}]);
  assert.equal(updated.creatorAddress, joy.creatorAddress);
  assert.equal(updated.creatorHandle, "NewName.ckb");
  assert.deepEqual(withCampaignCreatorIdentity(joy, [], []), joy);
});
