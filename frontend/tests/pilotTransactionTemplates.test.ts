import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { ccc } from "@ckb-ccc/core";
import { buildPilotWalletTransaction, encodePilotWalletState, pilotWalletLock, matchesPilotTransactionTemplate, validatePilotPolicies,
  PILOT_PASSKEY_CODE_HASH, PILOT_WALLET_GENERAL_CODE_HASH, PILOT_WALLET_SESSION_CODE_HASH, PILOT_TYPE_ID,
  type PilotWalletDescriptor, type PilotWalletState } from "@owl/pilot";
const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { buildFreightConnectionPolicies, selectedAccountSigner } = jiti("../lib/pilotConnectionPolicies.ts") as typeof import("../lib/pilotConnectionPolicies.ts");
const transactions = jiti("../lib/transactions.ts") as typeof import("../lib/transactions.ts");
const { freightRecipientScripts } = jiti("../lib/pilotTransactionTemplates.ts") as typeof import("../lib/pilotTransactionTemplates.ts");
const { FREIGHT_TRANSACTION_PERMISSIONS } = jiti("../lib/owlPermissions.ts") as typeof import("../lib/owlPermissions.ts");
const { buildCreateCampaignTransaction, buildRaffleTicketTransaction, sendUpdateCampaignStatus, freightStateLock, freightScript } = jiti("../lib/transactions.ts") as typeof import("../lib/transactions.ts");
const { encodeCampaignData, bytesToHex, encodeCreateCampaignArgs, encodeParticipantData } = jiti("../lib/encoding.ts") as typeof import("../lib/encoding.ts");
const { installPermissionHandler } = jiti("../lib/owlPermissions.ts") as typeof import("../lib/owlPermissions.ts");
const { CampaignType, CampaignStatus, ParticipantStatus } = jiti("../lib/contract.ts") as typeof import("../lib/contract.ts");
const h = (byte: string) => `0x${byte.repeat(32)}` as ccc.Hex;
const account: PilotWalletDescriptor = {
  version: 2, deployment: { network: "testnet", genesisHash: h("aa"), codeHash: PILOT_WALLET_GENERAL_CODE_HASH, outPoint: { txHash: h("bb"), index: 0 } },
  ownerLock: { codeHash: PILOT_PASSKEY_CODE_HASH, hashType: "data2", args: `0x${"22".repeat(97)}` },
  stateType: { codeHash: PILOT_TYPE_ID, hashType: "type", args: h("11") },
  poolLock: { codeHash: h("44"), hashType: "type", args: "0x" }, maxFee: "100000",
};
const lock = pilotWalletLock(account);
async function fixture() {
  const cells: ccc.Cell[] = [];
  const networkClient = new ccc.ClientPublicTestnet();
  const client = { getKnownScript: networkClient.getKnownScript.bind(networkClient),
    getTransaction: async () => ({blockHash: h("91")}), getHeaderByHash: async () => ({timestamp: 1n}), addressPrefix: "ckt", getTipHeader: async () => ({ hash: h("91"), timestamp: 2000n }),
    findCellsByLock: async function* () { yield cells[0]; },
    getCellLive: async (point: ccc.OutPointLike) => cells.find(cell => cell.outPoint.eq(point)),
  } as unknown as ccc.Client;
  const selected = { account, address: ccc.Address.fromScript(lock, client).toString(),
    ownerAddress: ccc.Address.fromScript(account.ownerLock, client).toString(), appOrigin: "https://freight.example" };
  // No chain campaign lookup is available or needed during connection.
  const catalog = await buildFreightConnectionPolicies(client, selected);
  const policies = catalog.filter(p => p.direction === "template");
  const state: PilotWalletState = { mode: "templates", publicKey: "0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    remaining: ccc.fixedPointFrom(1000000).toString(), sequence: "0", appOrigin: selected.appOrigin, policies: policies.slice(0, 3) };
  const anchor = ccc.Cell.from({ outPoint: { txHash: h("92"), index: 0 }, cellOutput: {
    lock, type: account.stateType, capacity: ccc.fixedPointFrom(1100000),
  }, outputData: encodePilotWalletState(state) });
  cells.push(anchor);
  const signer = selectedAccountSigner(client, selected);
  const validate = (tx: ccc.Transaction, policyId?: string) => {
    const selectedState = { ...state, policies: policyId ? policies.filter(p => p.template?.id === policyId) : state.policies };
    const selectedAnchor = anchor.clone(); selectedAnchor.outputData = encodePilotWalletState(selectedState);
    cells[0] = selectedAnchor;
    return buildPilotWalletTransaction(client, account, selectedState, tx, false, selectedAnchor);
  };
  return { cells, client, selected, catalog, policies, state, anchor, signer, validate };
}
const options = { campaignType: CampaignType.SimpleTask, startDurationSecs: 0n,
  taskDurationSecs: 0n, maximumAmountCkb: 1000n, auxAmountCkb: 0n, rewardCount: 1n, supportPoolBps: 0n,
  summary: "Text", randomnessHash: new Uint8Array(32) };

function raffle(f: Awaited<ReturnType<typeof fixture>>, recurring = false, nonce = 1): import("../lib/transactions.ts").CampaignCell {
  const data = { createdAt: BigInt(nonce), createdBy: new Uint8Array(20).fill(nonce),
    campaignType: recurring ? CampaignType.RecurringRaffle : CampaignType.Raffle,
    status: CampaignStatus.Active, startDurationSecs: 0n, taskDurationSecs: 600n, maximumAmount: 10000000000n,
    currentDeposits: 0n, rewardCount: 1n, randomnessHash: new Uint8Array(32).fill(nonce), summary: new Uint8Array(64),
    auxAmount: 100000000n, ticketSalesTotal: 0n, creatorSupportTotal: 0n, supportPoolBps: 0n,
    dataLayout: recurring ? "recurring" as const : "split-support" as const,
    ...(recurring ? {sleepDurationSecs: 60n, winnerReductionBps: 5000n, round: 1n, roundStartedAt: BigInt(nonce),
      roundRewardPerWinner: 0n, roundWinnerCount: 0n, prizePool: 0n} : {}),
  };
  const type = ccc.Script.from(freightScript(encodeCreateCampaignArgs(0n, 600n, data.campaignType,
    data.maximumAmount, data.auxAmount, data.randomnessHash, 1n, 0n, null,
    recurring ? {sleepDurationSecs: 60n, winnerReductionBps: 5000n} : null)));
  const cell = ccc.Cell.from({ outPoint: { txHash: h(nonce.toString(16).padStart(2, "0")), index: 0 }, cellOutput: {
    lock: freightStateLock(data.createdBy), type, capacity: ccc.fixedPointFrom(1000),
  }, outputData: bytesToHex(encodeCampaignData(data)) });
  f.cells.push(cell);
  return { outPoint: {txHash: cell.outPoint.txHash, index: Number(cell.outPoint.index)}, data, capacityShannons: cell.cellOutput.capacity, lock: cell.cellOutput.lock, type };
}

test("fresh general connection offers message scopes and all transaction actions without chain scans", async () => {
  const f = await fixture();
  assert.equal(f.catalog.length, 41);
  assert.equal(f.policies.length, 26);
  validatePilotPolicies(f.policies.slice(0, 16));
  assert.throws(() => validatePilotPolicies(f.policies.slice(0, 17)), /16/);
  assert.ok(f.catalog.filter(p => p.direction !== "message").every(p => p.direction === "template"));
  await assert.rejects(f.signer.provider.request("send"), /before signing authority/);
  await assert.rejects(buildFreightConnectionPolicies(f.client, { ...f.selected, ownerAddress: f.selected.address }), /inconsistent/);
  await assert.rejects(buildFreightConnectionPolicies(f.client, { ...f.selected,
    account: { ...account, deployment: { ...account.deployment, codeHash: PILOT_WALLET_SESSION_CODE_HASH } } }), /general signing account/);
});

test("one publish template accepts new configurations, campaign types and randomness without owner review", async () => {
  const f = await fixture();
  for (const campaignType of Object.values(CampaignType)) {
    const { tx } = await buildCreateCampaignTransaction(f.signer, { ...options, campaignType,
      maximumAmountCkb: 2000n + BigInt(campaignType), taskDurationSecs: 600n, startDurationSecs: 20n,
      auxAmountCkb: campaignType >= CampaignType.Raffle ? 2n : 0n,
      randomnessHash: new Uint8Array(32).fill(campaignType + 1) });
    await f.validate(tx);
  }
  const { tx } = await buildCreateCampaignTransaction(f.signer, options);
  const overBudget = tx.clone(); overBudget.outputs[0].capacity = ccc.fixedPointFrom(1000001);
  await assert.rejects(f.validate(overBudget), /spending budget/);
  const changed = tx.clone(); changed.outputs[0].lock.args = `0xff${"99".repeat(20)}`;
  await assert.rejects(f.validate(changed), /approved action template/);
  const wrongData = tx.clone(); const bytes = ccc.bytesFrom(wrongData.outputsData[0]); bytes[24] ^= 1; wrongData.outputsData[0] = ccc.hexFrom(bytes);
  await assert.rejects(f.validate(wrongData), /approved action template/);
  const wrongCode = tx.clone(); wrongCode.outputs[0].type!.codeHash = h("99");
  await assert.rejects(f.validate(wrongCode), /approved action template/);
  const extra = tx.clone(); extra.addOutput({lock: account.ownerLock, capacity: ccc.fixedPointFrom(100)}, "0x");
  await assert.rejects(f.validate(extra), /approved action template/);
});

test("publication permits approval and gift extensions without authorizing a different creator", async () => {
  const f = await fixture();
  const approvers = [{handle: "owner", address: f.selected.ownerAddress}];
  for (const campaignType of [CampaignType.Raffle, CampaignType.RecurringRaffle]) {
    const {tx} = await buildCreateCampaignTransaction(f.signer, { ...options, campaignType,
      startDurationSecs: 60n, taskDurationSecs: 600n, auxAmountCkb: 1n,
      raffleApproval: {stage: "on-commence", required: 1, approvers} });
    await f.validate(tx);
  }
  const {tx} = await buildCreateCampaignTransaction(f.signer, { ...options, campaignType: CampaignType.FundedTask,
    giftApproval: {stage: "gift-commence", required: 1, approvers},
    giftDeliverable: {enabled: true, approvalRule: {mode: "all"}, approvers,
      claimants: [{handle: "owner", address: f.selected.ownerAddress}], receivers: [],
      splitMode: "equal", ratioEntries: [], commencementState: "pending_approval",
      requiredApprovalCount: 1, approvals: []},
  });
  await f.validate(tx);
});

test("one ticket template covers future regular and recurring raffles, variable quantities and beneficiary checks", async () => {
  const f = await fixture();
  for (const recurring of [false, true]) {
    for (const nonce of [3, 7]) {
      const c = raffle(f, recurring, nonce + (recurring ? 10 : 0));
      for (const count of [1n, 2n, 64n]) await f.validate(await buildRaffleTicketTransaction(f.signer, c, count));
      const tx = await buildRaffleTicketTransaction(f.signer, c, 1n);
      const wrong = tx.clone(); wrong.outputs[1].lock.args = `0x${wrong.outputs[1].lock.args.slice(2, 60)}${"99".repeat(20)}`;
      await assert.rejects(f.validate(wrong), /approved action template/);
      const witness = tx.clone(); witness.setWitnessArgsAt(0, {outputType: "0x08"});
      await assert.rejects(f.validate(witness), /approved action template/);
      const redirected = tx.clone(); redirected.outputs[0].type!.args = "0x0099";
      await assert.rejects(f.validate(redirected), /approved action template/);
      const extra = tx.clone(); extra.addOutput({lock: account.ownerLock, capacity: ccc.fixedPointFrom(100)}, "0x");
      await assert.rejects(f.validate(extra), /approved action template/);
      await assert.rejects(f.validate(await buildRaffleTicketTransaction(f.signer, c, 65n)), /approved action template/);
    }
  }
});

test("activation uses the real status builder, preserves campaign contents and spends no account capacity", async () => {
  const f = await fixture();
  const c = raffle(f, false, 22); c.data.status = CampaignStatus.Created;
  f.cells[f.cells.length - 1].outputData = ccc.hexFrom(encodeCampaignData(c.data));
  const cleanup = installPermissionHandler(async (_signer, permission, operation) => {
    assert.equal(permission, "update-campaign-status");
    return operation({ sendTransaction: async (tx: ccc.Transaction) => {
      const match = matchesPilotTransactionTemplate(f.policies[1].template!, {
        inputs: [{output: f.cells[1].cellOutput, data: f.cells[1].outputData, index: 0}],
        outputs: [{output: tx.outputs[0], data: tx.outputsData[0], index: 0}], tx, spent: 0n,
      }, lock, ccc.Script.from(account.ownerLock));
      assert.equal(match, true);
      await f.validate(tx);
      const mutated = tx.clone(); mutated.outputs[0].capacity += 1n;
      await assert.rejects(f.validate(mutated), /approved action template/);
      return h("33");
    } } as unknown as ccc.Signer);
  });
  try { assert.equal(await sendUpdateCampaignStatus(f.signer, c), h("33")); }
  finally { cleanup(); }
});

async function capture(
  f: Awaited<ReturnType<typeof fixture>>, permission: import("../lib/owlPermissions.ts").FreightTransactionPermission,
  operation: () => Promise<unknown>, policyId = `freight.${permission}`,
) {
  let captured: ccc.Transaction | undefined;
  const cleanup = installPermissionHandler(async (_signer, action, send) => {
    assert.equal(action, permission);
    return send({ sendTransaction: async (tx: ccc.Transaction) => {
      captured = tx.clone();
      await f.validate(tx, policyId);
      // Selecting a different action must not grant this transaction.
      await assert.rejects(f.validate(tx, "freight.publish"), /approved action template/);
      const extra = tx.clone(); extra.addOutput({ lock: account.ownerLock, capacity: ccc.fixedPointFrom(500) }, "0x");
      await assert.rejects(f.validate(extra, policyId), /approved action template/);
      return h("33");
    } } as unknown as ccc.Signer);
  });
  try { await operation(); assert.ok(captured, `${permission} did not send a transaction`); return captured; }
  finally { cleanup(); }
}
function syncCampaign(f: Awaited<ReturnType<typeof fixture>>, c: import("../lib/transactions.ts").CampaignCell) {
  const cell = f.cells.find(cell => cell.outPoint.eq(c.outPoint))!;
  cell.cellOutput.lock = ccc.Script.from(c.lock);
  cell.outputData = ccc.hexFrom(encodeCampaignData(c.data));
}
function participant(f: Awaited<ReturnType<typeof fixture>>, c: import("../lib/transactions.ts").CampaignCell, index = 1, own = false) {
  const participantAddress = own ? ccc.bytesFrom(lock.args).slice(0, 20) : new Uint8Array(20).fill(index + 30);
  const data: import("../lib/encoding.ts").ParticipantData = { campaignCreatedBy: c.data.createdBy, campaignCreatedAt: c.data.createdAt,
    campaignType: c.data.campaignType, participantAddress, joinedAt: 10n, status: ParticipantStatus.Verified,
    depositedAmount: ccc.fixedPointFrom(1), ...(c.data.campaignType === CampaignType.RecurringRaffle ? {round: 1n, claimableAmount: 0n} : {}) };
  const entryLock = ccc.Script.from(freightScript(ccc.bytesFrom(`0xff${ccc.hexFrom(c.data.createdBy).slice(2)}${ccc.hexFrom(ccc.numLeToBytes(c.data.createdAt, 8)).slice(2)}${ccc.hexFrom(participantAddress).slice(2)}`)));
  const cell = ccc.Cell.from({ outPoint: {txHash: h((index + 90).toString(16).padStart(2, "0")), index: 1 },
    cellOutput: {lock: entryLock, capacity: ccc.fixedPointFrom(205)}, outputData: ccc.hexFrom(encodeParticipantData(data)) });
  f.cells.push(cell);
  return { outPoint: {txHash: cell.outPoint.txHash, index: Number(cell.outPoint.index)},
    data, lock: entryLock, type: null, capacityShannons: cell.cellOutput.capacity };
}

test("every FON transaction permission has a selectable template, separate from receipt messages", async () => {
  const f = await fixture();
  const legacy = { "create-campaign": "freight.publish", "update-campaign-status": "freight.status" };
  for (const permission of FREIGHT_TRANSACTION_PERMISSIONS) {
    const id = legacy[permission as keyof typeof legacy] ?? `freight.${permission}`;
    assert.ok(f.policies.some(p => p.template!.id === id || p.template!.id.startsWith(`${id}.`)), permission);
  }
  assert.ok(f.catalog.some(p => p.direction === "message" && p.name === "Sign support receipt"));
  assert.ok(f.catalog.some(p => p.direction === "message" && p.name === "Sign withdrawal receipt"));
});

test("support and creator-only cancel/withdraw builders match only their selected action", async () => {
  const f = await fixture();
  for (const recurring of [false, true]) {
    const c = raffle(f, recurring, recurring ? 32 : 31);
    await capture(f, "deposit", () => transactions.sendDepositShannons(f.signer, c, ccc.fixedPointFrom(200)));
  }
  const c = raffle(f, false, 33);
  c.data.createdBy = ccc.bytesFrom(lock.args).slice(0, 20); c.lock = freightStateLock(c.data.createdBy);
  c.data.currentDeposits = ccc.fixedPointFrom(200); c.data.creatorSupportTotal = c.data.currentDeposits;
  c.data.status = CampaignStatus.Completed; syncCampaign(f, c);
  await capture(f, "creator-withdraw", () => transactions.sendCreatorWithdraw(f.signer, c));
  c.data.status = CampaignStatus.Active; syncCampaign(f, c);
  const cancelled = await capture(f, "cancel-campaign", () => transactions.sendCancelCampaign(f.signer, c));
  const foreign = cancelled.clone(); const data = ccc.bytesFrom(foreign.outputsData[0]); data[24] ^= 1;
  foreign.outputsData[0] = ccc.hexFrom(data);
  await assert.rejects(f.validate(foreign, "freight.cancel-campaign"), /approved action template/);
});

test("approval and confirmation builders preserve the campaign and require their own selectors", async () => {
  const f = await fixture(); const c = raffle(f, false, 34);
  c.data.startDurationSecs = 600n;
  c.data.approval = {stage: "on-commence", required: 1, confirmed: false,
    approvers: [{ lockHash: ccc.bytesFrom(lock.hash()), approved: false }]}; syncCampaign(f, c);
  await capture(f, "approve-campaign", () => transactions.sendCampaignApproval(f.signer, c));
  c.data.approval.approvers[0].approved = true; syncCampaign(f, c);
  await capture(f, "confirm-raffle-approval", () => transactions.sendConfirmRaffleApproval(f.signer, c));
});

test("gift claims accept only account payouts and preserve the fixed campaign fields", async () => {
  const f = await fixture(); const c = raffle(f, false, 35);
  c.data.campaignType = CampaignType.FundedTask; c.data.currentDeposits = ccc.fixedPointFrom(200);
  c.data.gift = {creator: ccc.bytesFrom(lock.hash()), open: true,
    slots: [{claimant: new Uint8Array(32), amount: ccc.fixedPointFrom(200), claimed: false}]}; syncCampaign(f, c);
  const tx = await capture(f, "gift-claim", () => transactions.sendGiftClaim(f.signer, c));
  const redirected = tx.clone(); redirected.outputs[1].lock = ccc.Script.from(account.ownerLock);
  await assert.rejects(f.validate(redirected, "freight.gift-claim"), /approved action template/);
});

test("direct tip builders bind supported recipients to the campaign creator and reject redirects", async () => {
  const f = await fixture(); const recipients = await freightRecipientScripts(f.client);
  for (const [index, recipient] of recipients.entries()) {
    const c = raffle(f, false, 40 + index); c.data.campaignType = CampaignType.SimpleTask;
    const recipientLock = ccc.Script.from({codeHash: recipient.codeHash, hashType: recipient.hashType,
      args: ccc.hexFrom(new Uint8Array(recipient.name === "Pilot passkey" ? 97 : 32).fill(index + 1))});
    c.data.createdBy = ccc.bytesFrom(recipientLock.args).slice(0, 20); c.lock = freightStateLock(c.data.createdBy); syncCampaign(f, c);
    const policyId = `freight.creator-tip.${recipient.name.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    const tx = await capture(f, "creator-tip", () => transactions.sendCreatorTipShannons(f.signer, c,
      ccc.fixedPointFrom(200), ccc.Address.fromScript(recipientLock, f.client).toString()), policyId);
    const changed = tx.clone(); const args = ccc.bytesFrom(changed.outputs[1].lock.args); args[0] ^= 1;
    changed.outputs[1].lock.args = ccc.hexFrom(args);
    await assert.rejects(f.validate(changed, policyId), /approved action template/);
  }
});

test("reward delivery preserves every winner lock and identity for all eight supported batch sizes", async () => {
  for (let count = 1; count <= 8; count++) {
    const f = await fixture(); const c = raffle(f, false, 50);
    c.data.currentDeposits = ccc.fixedPointFrom(400); c.data.ticketSalesTotal = c.data.currentDeposits;
    c.data.rewardCount = BigInt(count); c.data.status = CampaignStatus.Completed; syncCampaign(f, c);
    const winners = Array.from({length: count}, (_, i) => participant(f, c, i + 1));
    const id = `freight.batch-deliver.${count}`;
    const tx = await capture(f, "batch-deliver", () => transactions.sendBatchDeliver(f.signer, c, winners, new Uint8Array(32)), id);
    for (let i = 1; i <= count; i++) {
      const redirected = tx.clone(); const args = ccc.bytesFrom(redirected.outputs[i].lock.args); args[29] ^= 1;
      redirected.outputs[i].lock.args = ccc.hexFrom(args);
      await assert.rejects(f.validate(redirected, id), /approved action template/);
      const data = tx.clone(); const bytes = ccc.bytesFrom(data.outputsData[i]); bytes[29] ^= 1; data.outputsData[i] = ccc.hexFrom(bytes);
      await assert.rejects(f.validate(data, id), /approved action template/);
    }
  }
});

test("recurring draw, rollover, claim and reclaim use their real builders and bind claims to this account", async () => {
  const f = await fixture(); const c = raffle(f, true, 60);
  c.data.currentDeposits = ccc.fixedPointFrom(200); c.data.prizePool = c.data.currentDeposits; syncCampaign(f, c);
  await capture(f, "draw-recurring-raffle", () => transactions.sendDrawRecurringRaffle(f.signer, c, [], new Uint8Array(32)));
  const entries = [participant(f, c, 1, true), participant(f, c, 2)];
  await capture(f, "draw-recurring-raffle", () => transactions.sendDrawRecurringRaffle(f.signer, c, entries, new Uint8Array(32)));
  c.data.status = CampaignStatus.Sleeping; c.data.roundWinnerCount = 2n; syncCampaign(f, c);
  await capture(f, "rollover-recurring-raffle", () => transactions.sendRolloverRecurringRaffle(f.signer, c));
  const own = entries[0]; own.data.status = ParticipantStatus.Winner; own.data.claimableAmount = ccc.fixedPointFrom(100);
  f.cells.find(cell => cell.outPoint.eq(own.outPoint))!.outputData = ccc.hexFrom(encodeParticipantData(own.data));
  await capture(f, "claim-recurring-raffle", () => transactions.sendClaimRecurringRaffle(f.signer, c, own));
  await capture(f, "reclaim-recurring-participant", () => transactions.sendReclaimRecurringParticipant(f.signer, c, own));
  const foreign = entries[1];
  const tx = ccc.Transaction.default(); tx.addCellDeps(transactions.FREIGHT_CELL_DEP);
  tx.addInput({previousOutput: c.outPoint, cellOutput: {capacity: c.capacityShannons, lock: c.lock, type: c.type}, outputData: ccc.hexFrom(encodeCampaignData(c.data))});
  tx.addInput({previousOutput: foreign.outPoint, cellOutput: {capacity: foreign.capacityShannons, lock: foreign.lock}, outputData: ccc.hexFrom(encodeParticipantData(foreign.data))});
  tx.addOutput({capacity: c.capacityShannons, lock: c.lock, type: c.type}, ccc.hexFrom(encodeCampaignData(c.data)));
  tx.addOutput({capacity: foreign.capacityShannons, lock}, "0x"); tx.setWitnessArgsAt(0, {outputType: "0x0c"});
  await assert.rejects(f.validate(tx, "freight.reclaim-recurring-participant"), /approved action template/);
});
