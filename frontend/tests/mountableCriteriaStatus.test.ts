import assert from "node:assert/strict";
import test from "node:test";

import { getMountableCriteriaStatus } from "../app/_lib/mountableCriteriaStatus.ts";
import type { CampaignRecord } from "../app/_types/campaignRecords.ts";

const record = {
  mountables: {
    lock: { enabled: true, criterion: "fbars", rule: "block_below", minimumFbars: "10" },
    forms: { enabled: true, formUrl: "https://docs.google.com/forms/d/example/viewform" },
    apps: [{
      enabled: true,
      appId: "sample",
      appName: "Sample app",
      appUrl: "https://sample.example/",
      mountableInstanceId: "sample-1",
      selectedPrinciples: [
        { principleId: "first", title: "First", displayLabel: "First criterion", readableFormat: "Complete {target}", paramsDefaults: {}, params: { target: "the first step" } },
        { principleId: "second", title: "Second", displayLabel: "Second criterion" },
      ],
    }],
  },
  giftDeliverable: { approvers: [{ handle: "alice" }] },
} as unknown as CampaignRecord;

test("lists every configured criterion with individual status and app readable text", () => {
  const criteria = getMountableCriteriaStatus({
    record,
    rows: [
      { participantKind: "forms_claim", status: "verified" },
      { mountableType: "app", mountableInstanceId: "sample-1", childSatisfied: false, criteriaState: [
        { principleId: "first", fulfilled: true },
        { principleId: "second", fulfilled: false },
      ] },
    ],
    viewerFbars: 10,
    signableCleared: true,
  });

  assert.deepEqual(criteria.map(({ key, cleared }) => [key, cleared]), [
    ["forms", true], ["lock", true], ["sample-1:first", true], ["sample-1:second", false], ["signable", true],
  ]);
  assert.equal(criteria.find(({ key }) => key === "sample-1:first")?.description, "Complete the first step");
  assert.equal(criteria.find(({ key }) => key === "sample-1:first")?.href, "https://sample.example/");
  assert.equal(criteria.find(({ key }) => key === "forms")?.href, "https://docs.google.com/forms/d/example/viewform");
  assert.equal(criteria.find(({ key }) => key === "lock")?.href, undefined);
  assert.equal(criteria.some(({ mountable }) => mountable === "Rewardable"), false);
});

test("shows pending built-in and app criteria before they clear", () => {
  const criteria = getMountableCriteriaStatus({
    record,
    rows: [{ participantKind: "forms_claim", status: "pending" }],
    viewerFbars: 9,
    signableCleared: false,
  });

  assert.equal(criteria.length, 5);
  assert.equal(criteria.every(({ cleared }) => !cleared), true);
});
