import assert from "node:assert/strict";
import test from "node:test";
import { isPublishedFreight, pendingFreightPublication } from "../lib/freightPublication.ts";

const draft = {
  _id: "draft-id", status: "draft", txHash: "0xtx", campaignId: "campaign-id",
  createdByHash: "creator", chainCreatedAt: "123", summaryDraft: "Freight", randomnessPreimage: "0xsecret",
};

test("only finalized published records appear in the feed", () => {
  assert.equal(isPublishedFreight(null), false);
  assert.equal(isPublishedFreight(draft), false);
  assert.equal(isPublishedFreight({ ...draft, status: "publish_failed" }), false);
  assert.equal(isPublishedFreight({ ...draft, status: "published", txHash: null }), false);
  assert.equal(isPublishedFreight({ ...draft, status: "published" }), true);
});

test("a broadcast draft resumes the same transaction after reopening", () => {
  assert.deepEqual(pendingFreightPublication(draft), {
    draftRecordId: draft._id, txHash: draft.txHash, campaignId: draft.campaignId,
    createdByHash: draft.createdByHash, chainCreatedAt: draft.chainCreatedAt,
    summaryDraft: draft.summaryDraft, randomnessPreimage: draft.randomnessPreimage,
  });
  assert.equal(pendingFreightPublication({ ...draft, txHash: null }), null);
  assert.equal(pendingFreightPublication({ ...draft, status: "published" }), null);
});
