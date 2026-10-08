import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { Address, Script, type Client } from "@ckb-ccc/core";

const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { verifyFreightCreateProof } = jiti("../lib/freightCreateProof.ts");
const { buildStableCampaignId } = jiti("../lib/campaignIdentity.ts");
const { bytesToHex, encodeCampaignData } = jiti("../lib/encoding.ts");
const { CampaignStatus, CampaignType, FREIGHT_CONTRACT } = jiti("../lib/contract.ts");

const creatorHash = new Uint8Array(20).fill(0x11);
const creatorLock = Script.from({ codeHash: `0x${"33".repeat(32)}`, hashType: "type", args: bytesToHex(creatorHash) });
const otherLock = Script.from({ codeHash: `0x${"44".repeat(32)}`, hashType: "type", args: `0x${"22".repeat(20)}` });
const stateLock = Script.from({ codeHash: FREIGHT_CONTRACT.codeHash, hashType: FREIGHT_CONTRACT.hashType, args: `0xff${bytesToHex(creatorHash).slice(2)}` });
const type = Script.from({ codeHash: FREIGHT_CONTRACT.codeHash, hashType: FREIGHT_CONTRACT.hashType, args: "0x00" });
const address = Address.fromScript(creatorLock, { addressPrefix: "ckt" } as Client).toString();
const campaignId = buildStableCampaignId(bytesToHex(creatorHash), 1234n, CampaignType.SimpleTask);
const outputData = bytesToHex(encodeCampaignData({
  createdAt: 1234n,
  startDurationSecs: 0n,
  taskDurationSecs: 60n,
  createdBy: creatorHash,
  campaignType: CampaignType.SimpleTask,
  maximumAmount: 0n,
  currentDeposits: 0n,
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

function client(status: string, payerLock = creatorLock, outputLock = stateLock) {
  return {
    addressPrefix: "ckt",
    getTransaction: async () => ({
      status,
      transaction: {
        inputs: [{ getCell: async () => ({ cellOutput: { lock: payerLock } }) }],
        outputs: [{ lock: outputLock, type }],
        outputsData: [outputData],
      },
    }),
  } as unknown as Client;
}

test("charges only after a committed creation signed by the creator", async () => {
  assert.equal(await verifyFreightCreateProof(client("pending"), `0x${"aa".repeat(32)}`, address, campaignId), false);
  assert.equal(await verifyFreightCreateProof(client("committed"), `0x${"aa".repeat(32)}`, address, campaignId), true);
});

test("rejects a freight paid for by another wallet", async () => {
  await assert.rejects(verifyFreightCreateProof(client("committed", otherLock), `0x${"aa".repeat(32)}`, address, campaignId), /creator wallet did not sign/);
});

test("rejects a transaction for another freight or creator lock", async () => {
  await assert.rejects(verifyFreightCreateProof(client("committed"), `0x${"aa".repeat(32)}`, address, "other"), /does not match this freight/);
  await assert.rejects(verifyFreightCreateProof(client("committed", creatorLock, otherLock), `0x${"aa".repeat(32)}`, address, campaignId), /does not create a freight/);
});
