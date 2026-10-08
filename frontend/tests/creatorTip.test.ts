import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { Address, Script, type Client } from "@ckb-ccc/core";

import type { CampaignCell } from "../lib/transactions.ts";

const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { Transaction } = jiti("@ckb-ccc/core");
const { freightStateLock, resolveCreatorTipLock, sendCreatorTipShannons } = jiti("../lib/transactions.ts");
const { bytesToHex } = jiti("../lib/encoding.ts");

const client = { addressPrefix: "ckt" } as Client;
const createdBy = new Uint8Array(20).fill(0x11);
const walletLock = Script.from({ codeHash: `0x${"33".repeat(32)}`, hashType: "type", args: bytesToHex(createdBy) });
const walletAddress = Address.fromScript(walletLock, client).toString();
const campaign = { lock: freightStateLock(createdBy), data: { createdBy } } as CampaignCell;

test("creator tip resolves the creator wallet lock instead of the freight state lock", async () => {
  const resolved = await resolveCreatorTipLock(client, campaign, walletAddress);
  assert.equal(resolved.codeHash, walletLock.codeHash);
  assert.equal(resolved.args, walletLock.args);
});

test("creator tip rejects missing and mismatched wallet addresses", async () => {
  await assert.rejects(resolveCreatorTipLock(client, campaign, null), /unavailable or does not match/);
  const otherLock = Script.from({ ...walletLock, args: bytesToHex(new Uint8Array(20).fill(0x22)) });
  const otherAddress = Address.fromScript(otherLock, client).toString();
  await assert.rejects(resolveCreatorTipLock(client, campaign, otherAddress), /unavailable or does not match/);
});

test("creator tip supports older campaign cells locked directly to the creator", async () => {
  const resolved = await resolveCreatorTipLock(client, { ...campaign, lock: walletLock }, null);
  assert.equal(resolved.args, walletLock.args);
});

test("creator tip sends output 1 directly to the creator wallet", async () => {
  const originalCompleteFeeBy = Transaction.prototype.completeFeeBy;
  Transaction.prototype.completeFeeBy = async function () { return [0, false]; };
  try {
    const fullCampaign = {
      ...campaign,
      outPoint: { txHash: `0x${"44".repeat(32)}`, index: 0 },
      capacityShannons: 200n * 100_000_000n,
      type: Script.from({ codeHash: `0x${"55".repeat(32)}`, hashType: "type", args: "0x00" }),
      data: {
        createdAt: 1n,
        startDurationSecs: 0n,
        taskDurationSecs: 0n,
        createdBy,
        campaignType: 0,
        maximumAmount: 0n,
        currentDeposits: 0n,
        status: 0,
        rewardCount: 0n,
        randomnessHash: new Uint8Array(32),
        summary: new Uint8Array(64),
        auxAmount: 0n,
        ticketSalesTotal: 0n,
        creatorSupportTotal: 0n,
        supportPoolBps: 0n,
        dataLayout: "split-support",
      },
    } as CampaignCell;
    const signer = {
      client: { ...client, getTipHeader: async () => ({ hash: `0x${"66".repeat(32)}` }) },
      sendTransaction: async (tx: InstanceType<typeof Transaction>) => {
        assert.equal(tx.outputs[0].capacity, fullCampaign.capacityShannons);
        assert.equal(tx.outputs[1].lock.codeHash, walletLock.codeHash);
        assert.equal(tx.outputs[1].lock.args, walletLock.args);
        assert.equal(tx.outputs[1].capacity, 61n * 100_000_000n);
        return `0x${"77".repeat(32)}`;
      },
    };
    await sendCreatorTipShannons(signer, fullCampaign, 61n * 100_000_000n, walletAddress);
  } finally {
    Transaction.prototype.completeFeeBy = originalCompleteFeeBy;
  }
});
