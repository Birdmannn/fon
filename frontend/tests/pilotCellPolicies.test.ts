import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { ccc } from "@ckb-ccc/core";
import { buildPilotWalletTransaction, encodePilotWalletState, pilotWalletLock, PILOT_PASSKEY_CODE_HASH, PILOT_WALLET_SESSION_CODE_HASH, PILOT_TYPE_ID, type PilotWalletDescriptor, type PilotWalletState } from "@owl/pilot";
import { freightPilotCatalog, freightMessagePolicy, ZERO_HASH } from "../lib/pilotProtocol.ts";
import type { FreightMessagePermission } from "../lib/owlPermissions.ts";

const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { freightTransactionPolicies } = jiti("../lib/pilotCellPolicies.ts") as typeof import("../lib/pilotCellPolicies.ts");
const { buildFreightConnectionPolicies, selectedAccountSigner } = jiti("../lib/pilotConnectionPolicies.ts") as typeof import("../lib/pilotConnectionPolicies.ts");
const { buildCreateCampaignTransaction, buildRaffleTicketTransaction, freightStateLock, freightScript } = jiti("../lib/transactions.ts") as typeof import("../lib/transactions.ts");
const { encodeCampaignData, bytesToHex } = jiti("../lib/encoding.ts") as typeof import("../lib/encoding.ts");
const { CampaignType, CampaignStatus } = jiti("../lib/contract.ts") as typeof import("../lib/contract.ts");
const h = (byte: string) => `0x${byte.repeat(32)}` as ccc.Hex;
const account: PilotWalletDescriptor = {
  version: 2, deployment: { network: "testnet", genesisHash: h("aa"), codeHash: PILOT_WALLET_SESSION_CODE_HASH, outPoint: { txHash: h("bb"), index: 0 } },
  ownerLock: { codeHash: PILOT_PASSKEY_CODE_HASH, hashType: "data2", args: `0x${"22".repeat(97)}` },
  stateType: { codeHash: PILOT_TYPE_ID, hashType: "type", args: h("11") },
  poolLock: { codeHash: h("44"), hashType: "type", args: "0x" }, maxFee: "100000",
};
const lock = pilotWalletLock(account);
const recipient = ccc.Script.from({ codeHash: h("66"), hashType: "type", args: h("77") });
const appType = ccc.Script.from({ codeHash: h("88"), hashType: "type", args: "0x00" });
function effects() {
  return ccc.Transaction.from({ outputs: [
    { lock: recipient, type: appType, capacity: ccc.fixedPointFrom(500) },
    { lock: recipient, capacity: ccc.fixedPointFrom(200) },
    { lock, capacity: ccc.fixedPointFrom(200) },
  ], outputsData: ["0xab", "0xcd", "0x"] });
}

test("transaction-only actions cannot become message policies; receipt scopes stay explicit", () => {
  assert.throws(() => freightMessagePolicy("buy-tickets" as FreightMessagePermission), /not a message permission/);
  assert.throws(() => freightMessagePolicy("create-campaign" as FreightMessagePermission), /not a message permission/);
  assert.equal(freightMessagePolicy("creator-withdraw").name, "Sign withdrawal receipt");
  assert.throws(() => freightPilotCatalog([freightMessagePolicy("deposit")]), /must describe input or output/);
});

test("generated output policies pass Pilot's automatic transaction checks without owner review", async () => {
  const tx = effects();
  const policies = await freightTransactionPolicies({ client: {} as ccc.Client, account, permission: "buy-tickets", transaction: tx });
  assert.equal(policies.length, 2, "ordinary account change needs no cell rule");
  assert.deepEqual(policies.map(p => p.direction), ["output", "output"]);
  assert.equal(policies[0].typeHash, appType.hash());
  assert.equal(policies[1].typeHash, ZERO_HASH, "zero means no type, not any type");
  assert.ok(freightPilotCatalog(policies).some(p => p.direction === "output"));
  const state: PilotWalletState = { publicKey: "0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    remaining: ccc.fixedPointFrom(1000).toString(), sequence: "0", appOrigin: "https://freight.example", policies };
  const anchor = ccc.Cell.from({ outPoint: { txHash: h("55"), index: 0 },
    cellOutput: { lock, type: account.stateType, capacity: ccc.fixedPointFrom(10000) }, outputData: encodePilotWalletState(state) });
  const client = { findCellsByLock: async function* () { yield anchor; }, getCellLive: async () => anchor } as unknown as ccc.Client;
  await buildPilotWalletTransaction(client, account, state, tx, false, anchor);
  const redirect = tx.clone(); redirect.outputs[0].lock = ccc.Script.from({ ...recipient, args: h("99") });
  await assert.rejects(buildPilotWalletTransaction(client, account, state, redirect, false, anchor), /outside session policies/);
  const changed = tx.clone(); changed.outputsData[0] = "0xff";
  await assert.rejects(buildPilotWalletTransaction(client, account, state, changed, false, anchor), /outside session policies/);
});

test("account asset inputs receive input rules; external input locks need no Pilot rule", async () => {
  const asset = ccc.Cell.from({ outPoint: { txHash: h("11"), index: 0 }, cellOutput: { lock, type: appType, capacity: ccc.fixedPointFrom(500) }, outputData: "0xab" });
  const external = ccc.Cell.from({ outPoint: { txHash: h("22"), index: 0 }, cellOutput: { lock: recipient, type: appType, capacity: ccc.fixedPointFrom(500) }, outputData: "0xab" });
  const client = { getCellLive: async (point: ccc.OutPointLike) => [asset, external].find(cell => cell.outPoint.eq(point)) } as unknown as ccc.Client;
  const tx = effects(); tx.addInput({ previousOutput: asset.outPoint }); tx.addInput({ previousOutput: external.outPoint });
  const policies = await freightTransactionPolicies({ client, account, permission: "deposit", transaction: tx, data: "any", maxCapacity: ccc.fixedPointFrom(1000) });
  assert.equal(policies.filter(p => p.direction === "input").length, 1);
  assert.equal(policies[0].lockHash, lock.hash());
  assert.ok(policies.every(p => p.dataHash === ZERO_HASH && p.maxCapacity === ccc.fixedPointFrom(1000).toString()));
  await assert.rejects(freightTransactionPolicies({ client, account, permission: "deposit", transaction: tx, maxCapacity: 1n }), /capacity ceiling/);
  await assert.rejects(freightTransactionPolicies({ client: { getCellLive: async () => undefined } as unknown as ccc.Client, account, permission: "deposit", transaction: tx }), /no longer live/);
});

test("the policy builder rejects wallet-managed authority outputs", async () => {
  const tx = effects(); tx.outputs[0].type = ccc.Script.from(account.stateType);
  await assert.rejects(freightTransactionPolicies({ client: {} as ccc.Client, account, permission: "buy-tickets", transaction: tx }), /wallet-managed/);
});

test("the pre-approval catalog authorizes actual FON publication and raffle-ticket builders", async () => {
  const data = { createdAt: 1000n, createdBy: new Uint8Array(20).fill(0x22), campaignType: CampaignType.Raffle,
    status: CampaignStatus.Active, startDurationSecs: 0n, taskDurationSecs: 600n, maximumAmount: 10000000000n,
    currentDeposits: 0n, rewardCount: 1n, randomnessHash: new Uint8Array(32), summary: new Uint8Array(64),
    auxAmount: 100000000n, ticketSalesTotal: 0n, creatorSupportTotal: 0n, supportPoolBps: 0n, dataLayout: "split-support" as const };
  const raffle = ccc.Cell.from({ outPoint: { txHash: h("90"), index: 0 }, cellOutput: {
    lock: freightStateLock(data.createdBy), type: freightScript(new Uint8Array([0])), capacity: ccc.fixedPointFrom(500),
  }, outputData: bytesToHex(encodeCampaignData(data)) });
  const cells: ccc.Cell[] = [raffle];
  const client = {
    addressPrefix: "ckt", getTipHeader: async () => ({ hash: h("91"), timestamp: 2000n }),
    findCells: async function* () { yield raffle; },
    findCellsByLock: async function* () { yield* cells.slice(1); },
    getCellLive: async (point: ccc.OutPointLike) => cells.find(cell => cell.outPoint.eq(point)),
  } as unknown as ccc.Client;
  const selected = { account, address: ccc.Address.fromScript(lock, client).toString(),
    ownerAddress: ccc.Address.fromScript(account.ownerLock, client).toString(), appOrigin: "https://freight.example" };
  const catalog = await buildFreightConnectionPolicies(client, selected);
  const policies = catalog.filter(p => p.direction !== "message");
  assert.equal(policies.length, 3, "publication, raffle state, and this owner's ticket entries");
  const state: PilotWalletState = { publicKey: "0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    remaining: ccc.fixedPointFrom(1000).toString(), sequence: "0", appOrigin: selected.appOrigin, policies };
  const anchor = ccc.Cell.from({ outPoint: { txHash: h("92"), index: 0 }, cellOutput: {
    lock, type: account.stateType, capacity: ccc.fixedPointFrom(10000),
  }, outputData: encodePilotWalletState(state) });
  cells.push(anchor);
  const signer = selectedAccountSigner(client, selected);
  const { tx } = await buildCreateCampaignTransaction(signer, { campaignType: CampaignType.SimpleTask, startDurationSecs: 0n,
    taskDurationSecs: 0n, maximumAmountCkb: 1000n, auxAmountCkb: 0n, rewardCount: 1n, supportPoolBps: 0n,
    summary: "Actual published text", randomnessHash: new Uint8Array(32) });
  await buildPilotWalletTransaction(client, account, state, tx, false, anchor);
  const campaign = { outPoint: { txHash: raffle.outPoint.txHash, index: 0 }, data,
    capacityShannons: raffle.cellOutput.capacity, lock: raffle.cellOutput.lock, type: raffle.cellOutput.type! };
  const tickets = await buildRaffleTicketTransaction(signer, campaign, 2n);
  await buildPilotWalletTransaction(client, account, state, tickets, false, anchor);
  // A valid composer source replaces the fallback with its actual configuration.
  const draftOptions = { campaignType: CampaignType.SimpleTask, startDurationSecs: 0n,
    taskDurationSecs: 0n, maximumAmountCkb: 2000n, auxAmountCkb: 0n, rewardCount: 1n,
    supportPoolBps: 0n, summary: "Draft text", randomnessHash: new Uint8Array(32) };
  const draftCatalog = await buildFreightConnectionPolicies(client, selected, [async actor => {
    const draft = await buildCreateCampaignTransaction(actor, draftOptions);
    return freightTransactionPolicies({ client, account, permission: "create-campaign", transaction: draft.tx,
      data: "any", maxCapacity: ccc.fixedPointFrom(1000000) });
  }]);
  const draftState = { ...state, policies: draftCatalog.filter(p => p.direction !== "message") };
  assert.equal(draftState.policies.length, 3, "draft replaces fallback rather than silently adding both");
  const draftAnchor = ccc.Cell.from({ ...anchor, outputData: encodePilotWalletState(draftState) });
  cells[1] = draftAnchor;
  const draft = await buildCreateCampaignTransaction(signer, { ...draftOptions, summary: "Edited text" });
  await buildPilotWalletTransaction(client, account, draftState, draft.tx, false, draftAnchor);
  await assert.rejects(buildPilotWalletTransaction(client, account, draftState, tx, false, draftAnchor), /outside session policies/);
  await assert.rejects(signer.provider.request("send"), /before signing authority/);
  await assert.rejects(buildFreightConnectionPolicies(client, { ...selected, ownerAddress: selected.address }), /inconsistent/);
});
