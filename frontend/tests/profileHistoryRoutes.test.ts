import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ccc } from "@ckb-ccc/core";
import { pilotWalletLock, PILOT_PASSKEY_CODE_HASH, PILOT_WALLET_GENERAL_CODE_HASH, PILOT_TYPE_ID } from "@owl/pilot";
const require = createRequire(import.meta.url);
const h = (byte: string) => `0x${byte.repeat(32)}` as ccc.Hex;
const client = new ccc.ClientPublicTestnet();
const ownerLock = ccc.Script.from({codeHash: PILOT_PASSKEY_CODE_HASH, hashType: "data2", args: `0x${"22".repeat(97)}`});
const address = ccc.Address.fromScript(ownerLock, client).toString();
function account(seed: string, owner = ownerLock) {
  return ccc.Address.fromScript(pilotWalletLock({version: 2,
    deployment: {network: "testnet", genesisHash: h("aa"), codeHash: PILOT_WALLET_GENERAL_CODE_HASH, outPoint: {txHash: h("bb"), index: 0}},
    ownerLock: owner, stateType: {codeHash: PILOT_TYPE_ID, hashType: "type", args: h(seed)},
    poolLock: {codeHash: h("44"), hashType: "type", args: "0x"}, maxFee: "100000"}), client).toString();
}
const sessionA = account("11"), sessionB = account("99");
const foreign = account("11", ccc.Script.from({...ownerLock, args: `0x${"77".repeat(97)}`}));
type Row = Record<string, unknown>;
function values(value: unknown, keys: string[]): unknown[] {
  if (!keys.length) return [value];
  if (Array.isArray(value)) return value.flatMap(entry => values(entry, keys));
  return value && typeof value === "object" ? values((value as Row)[keys[0]], keys.slice(1)) : [undefined];
}
function matches(row: Row, query: Row): boolean {
  return Object.entries(query).every(([key, expected]) => {
    if (key === "$or") return (expected as Row[]).some(condition => matches(row, condition));
    return values(row, key.split(".")).some(value => {
      if (!expected || typeof expected !== "object") return value === expected;
      return Object.entries(expected).every(([op, rule]) => {
        if (op === "$regex") return typeof value === "string" && (rule as RegExp).test(value);
        if (op === "$in") return (rule as unknown[]).includes(value ?? null);
        if (op === "$ne") return value !== rule;
        if (op === "$type") return typeof value === rule;
        if (op === "$exists") return (value !== undefined) === rule;
        if (op === "$elemMatch") return Array.isArray(value) && value.some(entry => matches(entry as Row, rule as Row));
        throw new Error(`Unsupported fixture query ${op}`);
      });
    });
  });
}
function collection(rows: Row[]) {
  return {find: (query: Row = {}) => ({toArray: async () => rows.filter(row => matches(row, query))}),
    countDocuments: async (query: Row) => rows.filter(row => matches(row, query)).length,
    distinct: async (field: string, query: Row) => [...new Set(rows.filter(row => matches(row, query))
      .flatMap(row => values(row, field.split("."))))]};
}

test("profile endpoints combine two Pilot sessions under the owner and exclude another owner's history", async () => {
  const now = new Date().toISOString(), stamp = String(Date.now()), createdByHash = ownerLock.hash().slice(0, 42);
  const campaignId = `${createdByHash}:${stamp}:4`;
  const record = {_id: "one", campaignId, createdByHash, campaignType: 4, chainCreatedAt: stamp,
    creatorAddress: address, title: "Pilot freight", status: "published", txHash: h("01"),
    activatedByAddress: sessionA, activatedAt: now, activatedTxHash: h("02"),
    settledByAddress: sessionB, settledAt: now, settlementTxHash: h("03"),
    withdrawnByAddress: sessionA, withdrawnAt: now, withdrawalTxHash: h("04"), withdrawnAmountShannons: "10000000000",
    settledRecipients: [{address: sessionB, amountLabel: "100 CKB", amountShannons: "10000000000", creditedUsdCents: 100}],
    socialMetadata: {comments: [{creatorAddress: sessionB, createdAt: now}]}};
  const participant = {campaignId, campaignType: 4, joinedAt: now};
  const event = {createdAt: now, delta: 1};
  const collections = {
    records: collection([record, {...record, _id: "foreign", campaignId: "foreign", creatorAddress: foreign, txHash: h("ff"),
      activatedByAddress: foreign, settledByAddress: foreign, withdrawnByAddress: foreign,
      settledRecipients: [{address: foreign}], socialMetadata: {comments: []}}]),
    participants: collection([{...participant, participantAddress: sessionA, participantTxHash: h("05")},
      {...participant, participantAddress: sessionB, participantTxHash: h("06"), participantKind: "gift_claim", claimAmountShannons: "10000000000", claimChainVerified: true},
      {...participant, participantAddress: foreign, participantTxHash: h("ff")}]),
    deposits: collection([{campaignId, depositorAddress: sessionA, depositedAt: now, txHash: h("07"), amountShannons: "20000000000"},
      {campaignId, depositorAddress: foreign, depositedAt: now, txHash: h("ff")}]),
    events: collection([{...event, address, kind: "wallet-seed", eventKey: "seed"},
      {...event, address, kind: "freight-create", eventKey: `freight-create:${h("01")}`, metadata: {campaignId, txHash: h("01")}},
      {...event, address: sessionA, kind: "deposit", eventKey: `deposit:${h("07")}`, metadata: {campaignId, txHash: h("07")}},
      {...event, address: foreign, kind: "deposit", eventKey: "foreign"}]),
    profiles: collection([{address, username: "Bird"}])};
  const temp = mkdtempSync(path.join(tmpdir(), "fon-history-routes-"));
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.__fonHistoryRouteCollections = collections;
  const aliases: Record<string, string> = {};
  const stubs = {
    mongodb: "const c=globalThis.__fonHistoryRouteCollections;export const getMongoCollection=async()=>c.records;export const getCampaignParticipantsCollection=async()=>c.participants;export const getCampaignDepositsCollection=async()=>c.deposits;export const getFbarEventsCollection=async()=>c.events;export const getUserProfilesCollection=async()=>c.profiles;",
    adsf: "export const reconcileAdsfForAddress=async()=>{};export const shannonsToUsdCents=()=>100;",
    ckbPrice: "export const fetchCkbUsdPrice=async()=>0.01;",
    txBalanceDelta: `export async function getAddressNetDeltaMap(hashes,addresses){if(!addresses.includes(${JSON.stringify(sessionA)})||!addresses.includes(${JSON.stringify(sessionB)}))throw Error('missing session amounts');return Object.fromEntries(hashes.map(hash=>[hash,'-20000000000']));}`};
  for (const [name, source] of Object.entries(stubs)) {
    const stub = path.join(temp, `${name}.mjs`); writeFileSync(stub, source);
    aliases[`@/lib/${name}`] = stub;
    aliases[`./${name}`] = stub;
    aliases[path.join(process.cwd(), "lib", name)] = stub;
    aliases[path.join(process.cwd(), "lib", `${name}.ts`)] = stub;
  }
  aliases["@"] = process.cwd();
  const jiti = require("jiti")(import.meta.url, {alias: aliases, moduleCache: false});
  try {
    const load = async (name: string) => {
      const {GET} = jiti(`../app/api/user-profiles/${name}/route.ts`) as {GET: (request: Request) => Promise<Response>};
      const response = await GET(new Request(`http://localhost/api/user-profiles/${name}?address=${address}`));
      const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result;
    };
    const transactions = await load("transactions");
    assert.equal(transactions.rows.length, 11);
    for (const summary of ["Activated raffle", "Distributed raffle rewards", "Claimed gift", "Deposited into freight", "Withdrew creator support"]) {
      assert.ok(transactions.rows.some((row: Row) => row.summary === summary), summary);
    }
    assert.ok(transactions.rows.every((row: Row) => row.txHash !== h("ff")));
    assert.equal(transactions.rows.find((row: Row) => row.summary === "Created freight").onchainNetDeltaShannons, "-20000000000");
    assert.deepEqual((await load("analytics")).totals, {produced: 1, participated: 2, rewarded: 1});
    const freights = await load("freights");
    assert.equal(freights.rows.length, 1);
    assert.deepEqual(freights.rows[0].interactionKinds, ["rewarded", "created", "participated", "commented"]);
    assert.equal(freights.rows[0].creatorAddress, address);
  } finally {delete globals.__fonHistoryRouteCollections; rmSync(temp, {recursive: true, force: true});}
});
