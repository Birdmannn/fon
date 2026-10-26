import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { ccc } from "@ckb-ccc/core";
import type { CampaignCell } from "../lib/transactions.ts";

const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { resolveLiveRaffleCampaign, confirmRaffleActivation } = jiti("../lib/rafflePurchaseState.ts");
const { encodeCampaignData, bytesToHex } = jiti("../lib/encoding.ts");
const { CampaignStatus, CampaignType } = jiti("../lib/contract.ts");
const h = (byte: string) => `0x${byte.repeat(32)}` as ccc.Hex;
const lock = ccc.Script.from({ codeHash: h("11"), hashType: "type", args: h("22") });
const type = ccc.Script.from({ codeHash: h("33"), hashType: "type", args: "0x00" });
const snapshot: CampaignCell = {
  outPoint: { txHash: h("44"), index: 0 }, lock, type, capacityShannons: ccc.fixedPointFrom(500),
  data: {
    createdAt: 1234n, createdBy: new Uint8Array(20).fill(0x55), campaignType: CampaignType.Raffle,
    status: CampaignStatus.Created, startDurationSecs: 0n, taskDurationSecs: 60n,
    maximumAmount: 10n, currentDeposits: 0n, rewardCount: 1n, randomnessHash: new Uint8Array(32),
    summary: new Uint8Array(64), auxAmount: 100000000n, ticketSalesTotal: 0n,
    creatorSupportTotal: 0n, supportPoolBps: 0n, dataLayout: "split-support",
  },
};
function cell(hash: ccc.Hex, overrides: Partial<CampaignCell["data"]> = {}) {
  return ccc.Cell.from({ outPoint: { txHash: hash, index: 0 },
    cellOutput: { lock, type, capacity: snapshot.capacityShannons },
    outputData: bytesToHex(encodeCampaignData({ ...snapshot.data, ...overrides })),
  });
}

test("replaces a spent modal snapshot with this raffle's live successor", async () => {
  const dead = cell(h("66"));
  const unrelated = cell(h("77"), { createdAt: 9999n });
  const successor = cell(h("88"), { status: CampaignStatus.Active, currentDeposits: 100000000n });
  const client = {
    getCellLive: async (point: ccc.OutPointLike) => [unrelated, successor].find(c => c.outPoint.eq(point)),
    findCells: async function* (query: ccc.ClientIndexerSearchKeyLike) {
      assert.equal(query.scriptSearchMode, "exact");
      assert.equal(ccc.Script.from(query.script).hash(), type.hash());
      yield dead; yield unrelated; yield successor;
    },
  } as unknown as ccc.Client;
  const resolved = await resolveLiveRaffleCampaign(client, snapshot);
  assert.equal(resolved.outPoint.txHash, successor.outPoint.txHash);
  assert.equal(resolved.data.status, CampaignStatus.Active);
  assert.equal(resolved.data.currentDeposits, 100000000n);
});

test("a live snapshot needs no indexer scan", async () => {
  const live = cell(snapshot.outPoint.txHash as ccc.Hex, { status: CampaignStatus.Active });
  const client = { getCellLive: async () => live, findCells: () => { throw new Error("Unexpected scan"); } } as unknown as ccc.Client;
  assert.equal((await resolveLiveRaffleCampaign(client, snapshot)).data.status, CampaignStatus.Active);
});

test("activation waits for commitment and reads its live output before stage two", async () => {
  const successor = cell(h("88"), { status: CampaignStatus.Active });
  let committed = false;
  const client = {
    waitTransaction: async (hash: string, confirmations: number) => {
      assert.equal(hash, successor.outPoint.txHash); assert.equal(confirmations, 1);
      committed = true; return { status: "committed" };
    },
    getCellLive: async (point: ccc.OutPointLike) => {
      assert.equal(committed, true); assert.ok(successor.outPoint.eq(point)); return successor;
    },
  } as unknown as ccc.Client;
  assert.equal((await confirmRaffleActivation(client, snapshot, successor.outPoint.txHash)).data.status, CampaignStatus.Active);
  await assert.rejects(confirmRaffleActivation({ waitTransaction: async () => ({ status: "pending" }) }, snapshot, "tx"), /still unconfirmed/);
});

test("missing live cells stop preparation instead of reusing a spent input", async () => {
  const client = { getCellLive: async () => undefined, findCells: async function* () {} } as unknown as ccc.Client;
  await assert.rejects(resolveLiveRaffleCampaign(client, snapshot), /live cell is not available/);
});
