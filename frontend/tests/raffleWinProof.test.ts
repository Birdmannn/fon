import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { Address, Script, type Client } from "@ckb-ccc/core";

const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { verifyRaffleSettlement, verifyRecurringRaffleCashout } = jiti("../lib/raffleWinProof.ts");
const { bytesToHex, encodeCampaignData, encodeParticipantData } = jiti("../lib/encoding.ts");
const { CampaignType, FREIGHT_CONTRACT, ParticipantStatus } = jiti("../lib/contract.ts");
const { awardFbarsEvent, computeRewardFbars } = jiti("../lib/fbars.ts");

const client = { addressPrefix: "ckt" } as Client;
const createdBy = new Uint8Array(20).fill(0x11);
const participantAddress = new Uint8Array(20).fill(0x22);
const walletScript = Script.from({ codeHash: `0x${"33".repeat(32)}`, hashType: "type", args: bytesToHex(participantAddress) });
const walletAddress = Address.fromScript(walletScript, client).toString();
const campaignLock = Script.from({ codeHash: `0x${"44".repeat(32)}`, hashType: "type", args: bytesToHex(createdBy) });
const campaignTypeScript = Script.from({ codeHash: FREIGHT_CONTRACT.codeHash, hashType: FREIGHT_CONTRACT.hashType, args: "0x00" });
const ticketLock = Script.from({ codeHash: FREIGHT_CONTRACT.codeHash, hashType: FREIGHT_CONTRACT.hashType, args: "0xff" });

function campaignData(campaignType: number, currentDeposits: bigint) {
  return {
    createdAt: 1234n,
    startDurationSecs: 0n,
    taskDurationSecs: 60n,
    createdBy,
    campaignType,
    maximumAmount: 100_000_000n,
    currentDeposits,
    status: 1,
    rewardCount: 1n,
    randomnessHash: new Uint8Array(32),
    summary: new Uint8Array(64),
    auxAmount: 0n,
    ticketSalesTotal: 0n,
    creatorSupportTotal: 0n,
    supportPoolBps: 0n,
    dataLayout: campaignType === CampaignType.RecurringRaffle ? "recurring" : "split-support",
    ...(campaignType === CampaignType.RecurringRaffle ? {
      sleepDurationSecs: 60n,
      winnerReductionBps: 5_000n,
      round: 1n,
      roundStartedAt: 1234n,
      roundRewardPerWinner: 1_000n,
      roundWinnerCount: 1n,
      prizePool: currentDeposits,
    } : {}),
  };
}

function record(campaignType: number) {
  return { createdByHash: bytesToHex(createdBy), chainCreatedAt: "1234", campaignType };
}

function transaction(campaignType: number, reward: bigint) {
  const recurring = campaignType === CampaignType.RecurringRaffle;
  const before = campaignData(campaignType, 10_000n);
  const after = campaignData(campaignType, 10_000n - reward);
  const participant = {
    campaignCreatedBy: createdBy,
    campaignCreatedAt: 1234n,
    campaignType,
    participantAddress,
    joinedAt: 2000n,
    status: recurring ? ParticipantStatus.Winner : ParticipantStatus.Verified,
    depositedAmount: 500n,
    ...(recurring ? { round: 1n, claimableAmount: reward } : {}),
  };
  const campaignCell = {
    cellOutput: { capacity: 20_000n, lock: campaignLock, type: campaignTypeScript },
    outputData: bytesToHex(encodeCampaignData(before)),
  };
  const participantCell = {
    cellOutput: { capacity: 1_000n, lock: ticketLock },
    outputData: bytesToHex(encodeParticipantData(participant)),
  };
  return {
    inputs: [{ getCell: async () => campaignCell }, { getCell: async () => participantCell }],
    outputs: [
      { capacity: 20_000n - reward, lock: campaignLock, type: campaignTypeScript },
      { capacity: 1_000n + reward, lock: recurring ? walletScript : ticketLock },
    ],
    outputsData: [
      bytesToHex(encodeCampaignData(after)),
      recurring ? "0x" : bytesToHex(encodeParticipantData({ ...participant, status: ParticipantStatus.Rewarded })),
    ],
  };
}

test("standard settlement awards the proven ticket owner and chain amount", async () => {
  const awards = await verifyRaffleSettlement(client, transaction(CampaignType.Raffle, 1_000n), record(CampaignType.Raffle), [
    { address: walletAddress, amountShannons: "1000" },
  ]);
  assert.deepEqual(awards, [{ address: walletAddress.toLowerCase(), amountShannons: 1_000n, outputIndex: 1 }]);
  await assert.rejects(
    verifyRaffleSettlement(client, transaction(CampaignType.Raffle, 1_000n), record(CampaignType.Raffle), [
      { address: walletAddress, amountShannons: "2000" },
    ]),
    /does not match the chain/,
  );
});

test("recurring cash-out awards only the proven winner", async () => {
  const award = await verifyRecurringRaffleCashout(client, transaction(CampaignType.RecurringRaffle, 1_000n), record(CampaignType.RecurringRaffle), walletAddress);
  assert.deepEqual(award, { address: walletAddress.toLowerCase(), amountShannons: 1_000n, outputIndex: 1 });
  await assert.rejects(
    verifyRecurringRaffleCashout(client, transaction(CampaignType.RecurringRaffle, 1_000n), record(CampaignType.Raffle), walletAddress),
    /matching on-chain raffle identity/,
  );
});

test("a fifth paid win earns amount-based lifetime FBARS and the weekly milestone", async () => {
  assert.equal(computeRewardFbars(999n * 100_000_000n), 0);
  assert.equal(computeRewardFbars(2_500n * 100_000_000n), 2);
  const profileUpdates: Array<{ $set: { fbars: number; weeklyFbarsState: { total: number; winCount: number } } }> = [];
  const profilesCollection = {
    findOne: async () => ({
      fbars: 7,
      weeklyFbarsState: { weekKey: "2026-10-05", total: 4, winCount: 4 },
    }),
    updateOne: async (_query: unknown, update: (typeof profileUpdates)[number]) => { profileUpdates.push(update); },
  };
  const eventsCollection = {
    findOne: async () => null,
    insertOne: async () => undefined,
  };
  await awardFbarsEvent({
    address: walletAddress,
    weekKey: "2026-10-05",
    eventKey: "win:test:1",
    kind: "win",
    delta: computeRewardFbars(2_500n * 100_000_000n),
    profilesCollection,
    eventsCollection,
  });
  assert.equal(profileUpdates[0]?.$set.fbars, 9);
  assert.equal(profileUpdates[0]?.$set.weeklyFbarsState.total, 16);
  assert.equal(profileUpdates[0]?.$set.weeklyFbarsState.winCount, 5);
});

test("a concurrent retry cannot apply the same win twice", async () => {
  let profileUpdated = false;
  const result = await awardFbarsEvent({
    address: walletAddress,
    weekKey: "2026-10-05",
    eventKey: "win:test:duplicate",
    kind: "win",
    delta: 1,
    profilesCollection: {
      findOne: async () => ({ fbars: 0 }),
      updateOne: async () => { profileUpdated = true; },
    },
    eventsCollection: {
      findOne: async () => null,
      insertOne: async () => { throw Object.assign(new Error("duplicate key"), { code: 11000 }); },
    },
  });
  assert.equal(result.applied, false);
  assert.equal(profileUpdated, false);
});
