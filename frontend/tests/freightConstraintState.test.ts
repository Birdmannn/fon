import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { Client } from "@ckb-ccc/core";

const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { freightApprovalConstraintSatisfied } = jiti("../lib/freightConstraintState.ts") as typeof import("../lib/freightConstraintState.ts");
const { bytesToHex, encodeCampaignData } = jiti("../lib/encoding.ts");
const { CampaignStatus, CampaignType, FREIGHT_CONTRACT } = jiti("../lib/contract.ts");
const { createEmptyGiftDeliverable } = jiti("../lib/giftDeliverables.ts");

const createdBy = new Uint8Array(20).fill(0x11);
const record = {
  campaignId: `${bytesToHex(createdBy)}:1234:${CampaignType.Raffle}`,
  createdByHash: bytesToHex(createdBy), chainCreatedAt: "1234", campaignType: CampaignType.Raffle,
  raffleApproval: { stage: "on-commence" as const, required: 1, approvers: [{ handle: "alice", address: null }] },
};
function client(approved: boolean, options: { confirmed?: boolean; createdAt?: bigint; missing?: boolean; wrongContract?: boolean } = {}) {
  return {
    async *findCells() {
      if (options.missing) return;
      yield {
        cellOutput: { type: { codeHash: options.wrongContract ? `0x${"00".repeat(32)}` : FREIGHT_CONTRACT.codeHash, hashType: FREIGHT_CONTRACT.hashType } },
        outputData: bytesToHex(encodeCampaignData({
          createdAt: options.createdAt ?? 1234n, startDurationSecs: 0n, taskDurationSecs: 60n,
          createdBy, campaignType: CampaignType.Raffle, maximumAmount: 1000n, currentDeposits: 0n,
          status: CampaignStatus.Created, rewardCount: 1n, randomnessHash: new Uint8Array(32),
          summary: new Uint8Array(64), auxAmount: 1n, ticketSalesTotal: 0n, creatorSupportTotal: 0n,
          supportPoolBps: 0n, dataLayout: "split-support",
          approval: { stage: "on-commence", required: 1, confirmed: options.confirmed ?? true,
            approvers: [{ lockHash: new Uint8Array(32).fill(7), approved }] },
        })),
      };
    },
  } as unknown as Client;
}

test("unconfigured approvals need no chain lookup", async () => {
  const noRpc = {} as Client;
  assert.equal(await freightApprovalConstraintSatisfied(noRpc, { ...record, raffleApproval: null }), true);
  assert.equal(await freightApprovalConstraintSatisfied(noRpc, {
    ...record, raffleApproval: null,
    giftDeliverable: { ...createEmptyGiftDeliverable(), enabled: false, approvers: [{ handle: "alice", address: null }] },
  }), true);
});

test("parent approval constraints require live quorum and commencement confirmation", async () => {
  assert.equal(await freightApprovalConstraintSatisfied(client(false), record), false);
  assert.equal(await freightApprovalConstraintSatisfied(client(true, { confirmed: false }), record), false);
  assert.equal(await freightApprovalConstraintSatisfied(client(true), record), true);
});

test("missing, unrelated or wrong-contract state cannot clear approval constraints", async () => {
  assert.equal(await freightApprovalConstraintSatisfied(client(true, { missing: true }), record), false);
  assert.equal(await freightApprovalConstraintSatisfied(client(true, { createdAt: 999n }), record), false);
  assert.equal(await freightApprovalConstraintSatisfied(client(true, { wrongContract: true }), record), false);
  assert.equal(await freightApprovalConstraintSatisfied(client(true), { ...record, campaignId: "different" }), false);
});
