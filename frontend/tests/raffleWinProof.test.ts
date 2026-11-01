import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { Address, Script, type Client } from "@ckb-ccc/core";

const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { verifyRaffleSettlement, verifyRecurringRaffleCashout } = jiti("../lib/raffleWinProof.ts");
const { bytesToHex, encodeCampaignData, encodeParticipantData } = jiti("../lib/encoding.ts");
const { CampaignType, FREIGHT_CONTRACT, ParticipantStatus } = jiti("../lib/contract.ts");
const { isRaffleProfileOwner, rafflePayoutMatchesIdentity } = jiti("../lib/rafflePayout.ts");
const { awardFbarsEvent, computeRewardFbars } = jiti("../lib/fbars.ts");

const client = { addressPrefix: "ckt" } as Client;
const createdBy = new Uint8Array(20).fill(0x11);
const participantAddress = new Uint8Array(20).fill(0x22);
const walletScript = Script.from({ codeHash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", hashType: "type", args: bytesToHex(participantAddress) });
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
      { capacity: 1_000n + reward, lock: walletScript },
    ],
    outputsData: [
      bytesToHex(encodeCampaignData(after)),
      "0x",
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

test("standard settlement rejects escrow outputs, locked data, redirects and inflated capacity", async () => {
  for (const mutation of ["escrow", "data", "redirect", "type", "capacity"] as const) {
    const tx = transaction(CampaignType.Raffle, 1_000n);
    if (mutation === "escrow") tx.outputs[1].lock = ticketLock;
    if (mutation === "data") tx.outputsData[1] = "0x01";
    if (mutation === "redirect") tx.outputs[1].lock = campaignLock;
    if (mutation === "type") Object.assign(tx.outputs[1], {type: campaignTypeScript});
    if (mutation === "capacity") tx.outputs[0].capacity += 1n;
    await assert.rejects(verifyRaffleSettlement(client, tx, record(CampaignType.Raffle), [
      {address: walletAddress, amountShannons: "1000"},
    ]), /wallet output|freight escrow/);
  }
});

test("Pilot owner payouts bind to the ticket identity and the complete session owner commitment", async () => {
  const owner = Script.from({codeHash: "0x2ba431b27a844a3664e24c548ecd175cea3ba005590f4f362bee5a94acac92e6",
    hashType: "data2", args: `0x${"22".repeat(97)}`});
  const session = Script.from({codeHash: "0x37d1ff519ae19f7b16cd7ee9b4f726300cdcc6fece923bf8bee40466a15cef28",
    hashType: "data2", args: `${owner.hash()}${"00".repeat(72)}`});
  const identity = owner.hash().slice(0, 42);
  assert.ok(isRaffleProfileOwner(owner, session));
  assert.ok(rafflePayoutMatchesIdentity(owner, identity));
  const forgedSession = session.clone();
  forgedSession.args = `${identity}${"ff".repeat(12)}${"00".repeat(72)}` as `0x${string}`;
  assert.equal(isRaffleProfileOwner(owner, forgedSession), false);
  const foreign = owner.clone(); foreign.args = `0x${"23".repeat(97)}`;
  assert.equal(rafflePayoutMatchesIdentity(foreign, identity), false);
  const tx = transaction(CampaignType.Raffle, 1_000n);
  const ticket = await tx.inputs[1].getCell();
  const data = new Uint8Array(Buffer.from(ticket.outputData.slice(2), "hex"));
  data.set(Buffer.from(identity.slice(2), "hex"), 29);
  ticket.outputData = bytesToHex(data);
  tx.outputs[1].lock = owner;
  const address = Address.fromScript(owner, client).toString();
  const awards = await verifyRaffleSettlement(client, tx, record(CampaignType.Raffle), [{address, amountShannons: "1000"}]);
  assert.equal(awards[0].address, address.toLowerCase());
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
