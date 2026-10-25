import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { Address, Script, type Client } from "@ckb-ccc/core";
import { pilotWalletLock, PILOT_PASSKEY_CODE_HASH, PILOT_WALLET_SESSION_CODE_HASH, PILOT_TYPE_ID, type PilotWalletDescriptor } from "@owl/pilot";

const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { verifyFreightCreateProof } = jiti("../lib/freightCreateProof.ts");
const { buildStableCampaignId } = jiti("../lib/campaignIdentity.ts");
const { bytesToHex, encodeCampaignData, decodeCampaignData, hexToBytes, lockScriptToAddressBytes } = jiti("../lib/encoding.ts");
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

test("Pilot creation charges the owner profile while proving the session's transaction", async () => {
  const ownerLock = Script.from({ codeHash: PILOT_PASSKEY_CODE_HASH, hashType: "data2", args: `0x${"22".repeat(97)}` });
  const account: PilotWalletDescriptor = {
    version: 2,
    deployment: { network: "testnet", genesisHash: `0x${"aa".repeat(32)}`, codeHash: PILOT_WALLET_SESSION_CODE_HASH, outPoint: { txHash: `0x${"bb".repeat(32)}`, index: 0 } },
    ownerLock, stateType: { codeHash: PILOT_TYPE_ID, hashType: "type", args: `0x${"11".repeat(32)}` },
    poolLock: otherLock, maxFee: "100000",
  };
  const session = pilotWalletLock(account);
  const creator = bytesToHex(lockScriptToAddressBytes(session));
  const owner = Address.fromScript(ownerLock, { addressPrefix: "ckt" } as Client).toString();
  const id = buildStableCampaignId(creator, 1234n, CampaignType.SimpleTask);
  const data = bytesToHex(encodeCampaignData({ ...decodeCampaignData(hexToBytes(outputData)), createdBy: lockScriptToAddressBytes(session) }));
  const mock = {
    addressPrefix: "ckt",
    getTransaction: async () => ({ status: "committed", transaction: {
      outputs: [{ type, lock: Script.from({ ...stateLock, args: `0xff${creator.slice(2)}` }) }],
      outputsData: [data], inputs: [{ getCell: async () => ({ cellOutput: { lock: session } }) }],
    } }),
  } as unknown as Client;
  assert.equal(await verifyFreightCreateProof(mock, "tx", owner, id, account), true);
  await assert.rejects(verifyFreightCreateProof(mock, "tx", address, id, account), /owner does not match/);
  await assert.rejects(verifyFreightCreateProof(mock, "tx", owner, id, { ...account, stateType: { ...account.stateType, args: `0x${"99".repeat(32)}` } }), /creator wallet did not sign/);
});
