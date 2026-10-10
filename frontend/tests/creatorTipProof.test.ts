import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { Address, Script, type Client } from "@ckb-ccc/core";

const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { verifyCreatorTip } = jiti("../lib/creatorTipProof.ts");
const { bytesToHex, encodeCampaignData } = jiti("../lib/encoding.ts");
const { CampaignStatus, CampaignType, FREIGHT_CONTRACT } = jiti("../lib/contract.ts");

const clientAddress = { addressPrefix: "ckt" } as Client;
const createdBy = new Uint8Array(20).fill(0x11);
const payerLock = Script.from({ codeHash: `0x${"22".repeat(32)}`, hashType: "type", args: `0x${"33".repeat(20)}` });
const otherLock = Script.from({ codeHash: `0x${"44".repeat(32)}`, hashType: "type", args: `0x${"55".repeat(20)}` });
const creatorLock = Script.from({ codeHash: `0x${"66".repeat(32)}`, hashType: "type", args: bytesToHex(createdBy) });
const stateLock = Script.from({ codeHash: FREIGHT_CONTRACT.codeHash, hashType: FREIGHT_CONTRACT.hashType, args: `0xff${bytesToHex(createdBy).slice(2)}` });
const freightType = Script.from({ codeHash: FREIGHT_CONTRACT.codeHash, hashType: FREIGHT_CONTRACT.hashType, args: "0x00" });
const payerAddress = Address.fromScript(payerLock, clientAddress).toString();
const creatorAddress = Address.fromScript(creatorLock, clientAddress).toString();
const amount = 61n * 100_000_000n;
const record = {
  campaignId: `${bytesToHex(createdBy)}:1234:${CampaignType.SimpleTask}`,
  creatorAddress,
  campaignType: CampaignType.SimpleTask,
};

function campaignData(currentDeposits: bigint) {
  return bytesToHex(encodeCampaignData({
    createdAt: 1234n,
    startDurationSecs: 0n,
    taskDurationSecs: 60n,
    createdBy,
    campaignType: CampaignType.SimpleTask,
    maximumAmount: 0n,
    currentDeposits,
    status: CampaignStatus.Created,
    rewardCount: 0n,
    randomnessHash: new Uint8Array(32),
    summary: new Uint8Array(64),
    auxAmount: 0n,
    ticketSalesTotal: 0n,
    creatorSupportTotal: 0n,
    supportPoolBps: 0n,
    dataLayout: "split-support",
  }));
}

function client(options: { status?: string; payer?: Script; recipient?: Script; amount?: bigint } = {}) {
  return {
    addressPrefix: "ckt",
    getTransaction: async () => ({
      status: options.status ?? "committed",
      transaction: {
        inputs: [
          { getCell: async () => ({ cellOutput: { lock: stateLock, type: freightType, capacity: 100n }, outputData: campaignData(0n) }) },
          { getCell: async () => ({ cellOutput: { lock: options.payer ?? payerLock } }) },
        ],
        outputs: [
          { lock: stateLock, type: freightType, capacity: 100n },
          { lock: options.recipient ?? creatorLock, capacity: options.amount ?? amount },
        ],
        outputsData: [campaignData(amount)],
      },
    }),
  } as unknown as Client;
}

test("accepts a committed direct tip from its payer", async () => {
  assert.equal(await verifyCreatorTip(client(), "tx", payerAddress, record, amount), true);
  assert.equal(await verifyCreatorTip(client({ status: "pending" }), "tx", payerAddress, record, amount), false);
});

test("rejects a tip claimed by another wallet", async () => {
  await assert.rejects(verifyCreatorTip(client({ payer: otherLock }), "tx", payerAddress, record, amount), /not paid by this wallet/);
});

test("rejects tips for another recipient, amount, or freight", async () => {
  await assert.rejects(verifyCreatorTip(client({ recipient: otherLock }), "tx", payerAddress, record, amount), /does not pay the freight creator/);
  await assert.rejects(verifyCreatorTip(client({ amount: amount + 1n }), "tx", payerAddress, record, amount), /does not pay the freight creator/);
  await assert.rejects(verifyCreatorTip(client(), "tx", payerAddress, { ...record, campaignId: "other" }, amount), /selected freight/);
});
