import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { ccc } from "@ckb-ccc/core";
import { buildPilotWalletTransaction, encodePilotWalletState, pilotWalletLock, matchesPilotTransactionTemplate,
  PILOT_PASSKEY_CODE_HASH, PILOT_WALLET_GENERAL_CODE_HASH, PILOT_WALLET_SESSION_CODE_HASH, PILOT_TYPE_ID,
  type PilotWalletDescriptor, type PilotWalletState } from "@owl/pilot";
const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { buildFreightConnectionPolicies, selectedAccountSigner } = jiti("../lib/pilotConnectionPolicies.ts") as typeof import("../lib/pilotConnectionPolicies.ts");
const { buildCreateCampaignTransaction, buildRaffleTicketTransaction, sendUpdateCampaignStatus, freightStateLock, freightScript } = jiti("../lib/transactions.ts") as typeof import("../lib/transactions.ts");
const { encodeCampaignData, bytesToHex, encodeCreateCampaignArgs } = jiti("../lib/encoding.ts") as typeof import("../lib/encoding.ts");
const { installPermissionHandler } = jiti("../lib/owlPermissions.ts") as typeof import("../lib/owlPermissions.ts");
const { CampaignType, CampaignStatus } = jiti("../lib/contract.ts") as typeof import("../lib/contract.ts");
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
  const client = { addressPrefix: "ckt", getTipHeader: async () => ({ hash: h("91"), timestamp: 2000n }),
    findCellsByLock: async function* () { yield cells[0]; },
    getCellLive: async (point: ccc.OutPointLike) => cells.find(cell => cell.outPoint.eq(point)),
  } as unknown as ccc.Client;
  const selected = { account, address: ccc.Address.fromScript(lock, client).toString(),
    ownerAddress: ccc.Address.fromScript(account.ownerLock, client).toString(), appOrigin: "https://freight.example" };
  // No chain campaign lookup is available or needed during connection.
  const catalog = await buildFreightConnectionPolicies(client, selected);
  const policies = catalog.filter(p => p.direction === "template");
  const state: PilotWalletState = { mode: "templates", publicKey: "0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    remaining: ccc.fixedPointFrom(1000000).toString(), sequence: "0", appOrigin: selected.appOrigin, policies };
  const anchor = ccc.Cell.from({ outPoint: { txHash: h("92"), index: 0 }, cellOutput: {
    lock, type: account.stateType, capacity: ccc.fixedPointFrom(1100000),
  }, outputData: encodePilotWalletState(state) });
  cells.push(anchor);
  const signer = selectedAccountSigner(client, selected);
  const validate = (tx: ccc.Transaction) => buildPilotWalletTransaction(client, account, state, tx, false, anchor);
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

test("fresh general connection offers message scopes and three whole-action templates without chain scans", async () => {
  const f = await fixture();
  assert.equal(f.catalog.length, 18);
  assert.equal(f.policies.length, 3);
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
