import { ccc } from "@ckb-ccc/core";
import { PILOT_PASSKEY_CODE_HASH, PILOT_WALLET_GENERAL_CODE_HASH, pilotTemplatePolicy,
  type PilotScriptPattern, type PilotTemplateCell, type PilotTemplateField, type PilotTemplateRepeatedField, type PilotTransactionTemplate } from "@owl/pilot";
import { FREIGHT_CONTRACT } from "./contract";
import type { FreightTransactionPermission } from "./owlPermissions";

export const FREIGHT_PILOT_BUDGET = ccc.fixedPointFrom(1_000_000);
export const PILOT_AUTOMATIC_TICKET_LIMIT = 64;
const identity = { account: "accountLockArgs" as const, offset: 0, length: 20 };
const app = (args: Extract<PilotScriptPattern, object>["args"]): PilotScriptPattern => ({
  codeHash: FREIGHT_CONTRACT.codeHash as ccc.Hex, hashType: FREIGHT_CONTRACT.hashType, args,
});
const campaignLock = app({ prefix: "0xff", length: 21 });
const campaignType = app({ prefix: "0x00" });
const campaign: PilotTemplateCell = {
  role: "campaign", lock: campaignLock, type: campaignType,
  // Base, split-support, recurring, approval and gift layouts share this header.
  data: { minLength: 174, maxLength: 65536 },
};
const field = (source: "input" | "output", role: string, key: PilotTemplateField["field"], offset?: number, length?: number): PilotTemplateField => ({
  source, role, field: key, ...(offset === undefined ? {} : { offset }), ...(length === undefined ? {} : { length }),
});
const preserve = (key: PilotTemplateField["field"], offset?: number, length?: number) => ({
  left: field("input", "campaign", key, offset, length), right: field("output", "campaign", key, offset, length),
});
const campaignIdentity = [preserve("lock"), preserve("type"), preserve("data", 0, 8), preserve("data", 24, 20),
  { left: field("input", "campaign", "lockArgs", 1, 20), right: field("input", "campaign", "data", 24, 20) }];

export interface FreightRecipientScript { name: string; codeHash: ccc.Hex; hashType: ccc.HashType }

/** Resolve network-specific wallet scripts locally, before the session is approved. */
export async function freightRecipientScripts(client: ccc.Client): Promise<FreightRecipientScript[]> {
  const scripts = await Promise.all([ccc.KnownScript.JoyId, ccc.KnownScript.Secp256k1Blake160, ccc.KnownScript.OmniLock]
    .map(async name => ({ name, ...await client.getKnownScript(name) })));
  return [...scripts.map(({ name, codeHash, hashType }) => ({ name, codeHash, hashType })),
    { name: "Pilot account", codeHash: PILOT_WALLET_GENERAL_CODE_HASH, hashType: "data2" as const },
    { name: "Pilot passkey", codeHash: PILOT_PASSKEY_CODE_HASH, hashType: "data2" as const }];
}

export const PILOT_AUTOMATIC_DELIVERY_LIMIT = 64;
const entry: PilotTemplateCell = { role: "entry", lock: app({ prefix: "0xff", length: 49 }), type: null,
  data: { minLength: 66, maxLength: 82 } };
const ownEntry: PilotTemplateCell = { ...entry,
  lock: app({ prefix: "0xff", length: 49, fields: [{ offset: 29, value: identity }] }),
  data: { ...entry.data, fields: [{ offset: 29, value: identity }] } };
const ownCampaign: PilotTemplateCell = { ...campaign,
  lock: app({ prefix: "0xff", length: 21, fields: [{ offset: 1, value: identity }] }),
  data: { ...campaign.data, fields: [{ offset: 24, value: identity }] } };
const entryCampaign = [
  { left: field("input", "entry", "data", 0, 20), right: field("input", "campaign", "data", 24, 20) },
  { left: field("input", "entry", "data", 20, 8), right: field("input", "campaign", "data", 0, 8) },
];
const recurringCampaign: PilotTemplateCell = { ...campaign,
  data: { ...campaign.data, minLength: 254, fields: [{ offset: 44, value: "0x05" }] } };

/** Whole-transaction rules; all other application inputs/outputs are rejected. */
export function freightTransactionTemplates(recipients: readonly FreightRecipientScript[]) {
  const publish: PilotTransactionTemplate = {
    version: 1, id: "freight.publish", maxSpend: FREIGHT_PILOT_BUDGET.toString(), inputs: [],
    outputs: [{ ...campaign, lock: app({ prefix: "0xff", length: 21, fields: [{ offset: 1, value: identity }] }),
      capacity: { max: FREIGHT_PILOT_BUDGET.toString() },
      data: { ...campaign.data, fields: [{ offset: 24, value: identity }, { offset: 61, value: "0x00" }] },
    }],
  };
  const status: PilotTransactionTemplate = {
    version: 1, id: "freight.status", maxSpend: "0", inputs: [campaign], outputs: [campaign],
    relations: [...campaignIdentity, preserve("capacity"), preserve("data", 0, 61), preserve("data", 62)],
    witnesses: [{ inputRole: "campaign", field: "outputType", equals: "0x04" }],
  };
  const buy: PilotTransactionTemplate = {
    version: 1, id: "freight.buy-tickets", maxSpend: FREIGHT_PILOT_BUDGET.toString(), inputs: [campaign],
    outputs: [campaign, {
      role: "ticket", min: 1, max: PILOT_AUTOMATIC_TICKET_LIMIT,
      lock: app({ prefix: "0xff", length: 49, fields: [{ offset: 29, value: identity }] }), type: null,
      capacity: { min: ccc.fixedPointFrom(187).toString(), max: ccc.fixedPointFrom(205).toString() },
      data: { minLength: 66, maxLength: 82, fields: [{ offset: 29, value: identity }, { offset: 57, value: "0x01" }] },
    }],
    relations: [...campaignIdentity, preserve("data", 8, 16), preserve("data", 44, 9), preserve("data", 61, 113)],
    // Prefix permits both legacy 0x03 and 0x03 + u64 ticket-count encodings.
    witnesses: [{ inputRole: "campaign", field: "outputType", prefix: "0x03" }],
  };
  const policies = [pilotTemplatePolicy("Publish freight", publish),
    pilotTemplatePolicy("Update freight status (includes raffle activation)", status),
    pilotTemplatePolicy("Buy raffle tickets", buy)];
  const add = (permission: FreightTransactionPermission, name: string, selector: ccc.Hex,
    options: Partial<PilotTransactionTemplate> = {}, prefix = false) => {
    policies.push(pilotTemplatePolicy(name, {
      version: 1, id: `freight.${permission}`, maxSpend: "0", inputs: [campaign], outputs: [campaign],
      relations: campaignIdentity,
      witnesses: [{ inputRole: "campaign", field: "outputType", [prefix ? "prefix" : "equals"]: selector }],
      ...options,
    }));
  };
  add("approve-campaign", "Approve freight", "0x0d", {
    relations: [...campaignIdentity, preserve("capacity"), preserve("data", 0, 198)],
  }, true);
  add("confirm-raffle-approval", "Confirm raffle approval", "0x0e", {
    relations: [...campaignIdentity, preserve("capacity"), preserve("data", 0, 198)],
  });
  add("cancel-campaign", "Cancel freight", "0x06", {
    inputs: [ownCampaign], outputs: [ownCampaign],
    relations: [...campaignIdentity, preserve("capacity"), preserve("data", 0, 61), preserve("data", 62)],
  });
  add("gift-claim", "Claim a gift", "0x0f", {
    // Only the account's ordinary payout is wallet-managed. An external payout
    // is an unexpected effect and cannot match this rule. Allow occupied-capacity top-ups.
    maxSpend: ccc.fixedPointFrom(1000).toString(),
    relations: [...campaignIdentity, preserve("data", 0, 53), preserve("data", 62, 136)],
  }, true);
  add("deposit", "Deposit support", "0x01", {
    maxSpend: FREIGHT_PILOT_BUDGET.toString(),
    relations: [...campaignIdentity, preserve("data", 0, 53), preserve("data", 61, 121)],
  }, true);
  for (const recipient of recipients) {
    add("creator-tip", `Tip a creator (${recipient.name})`, "0x01", {
      id: `freight.creator-tip.${recipient.name.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
      maxSpend: FREIGHT_PILOT_BUDGET.toString(),
      outputs: [campaign, { role: "creator", lock: { codeHash: recipient.codeHash, hashType: recipient.hashType,
        args: {} }, type: null, data: { length: 0 }, capacity: { max: FREIGHT_PILOT_BUDGET.toString() } }],
      relations: [...campaignIdentity, preserve("capacity"), preserve("data", 0, 53), preserve("data", 61),
        { left: field("input", "campaign", "data", 24, 20), right: field("output", "creator", "lockArgs", 0, 20) }],
    }, true);
  }
  // One permission covers bounded variable batches. Every entry pair preserves
  // its lock/identity and each input is bound to the shared campaign.
  const eachEntry = (source: "input" | "output", key: PilotTemplateField["field"], offset?: number, length?: number): PilotTemplateRepeatedField => ({
    ...field(source, "entry", key, offset, length), index: "each",
  });
  const preserveEntry = (key: PilotTemplateField["field"], offset?: number, length?: number) => ({
    left: eachEntry("input", key, offset, length), right: eachEntry("output", key, offset, length),
  });
  add("batch-deliver", "Distribute rewards", "0x02", {
    inputs: [campaign, { ...entry, min: 1, max: PILOT_AUTOMATIC_DELIVERY_LIMIT,
      data: { length: 66, fields: [{ offset: 57, value: "0x01" }] } }],
    outputs: [campaign, { ...entry, min: 1, max: PILOT_AUTOMATIC_DELIVERY_LIMIT,
      data: { length: 66, fields: [{ offset: 57, value: "0x02" }] } }],
    relations: campaignIdentity,
    forEach: [{ inputRole: "entry", outputRole: "entry", relations: [
      preserveEntry("lock"), preserveEntry("data", 0, 57), preserveEntry("data", 58),
      ...entryCampaign.map(r => ({ left: { ...r.left, index: "each" as const }, right: r.right })),
      { left: eachEntry("input", "lockArgs", 1, 28), right: eachEntry("input", "data", 0, 28) },
      { left: eachEntry("input", "lockArgs", 29, 20), right: eachEntry("input", "data", 29, 20) },
    ] }],
  }, true);
  add("creator-withdraw", "Withdraw support", "0x08", {
    inputs: [ownCampaign], outputs: [ownCampaign], maxSpend: ccc.fixedPointFrom(1000).toString(),
    relations: [...campaignIdentity, preserve("data", 0, 53), preserve("data", 61, 113)],
  });
  add("draw-recurring-raffle", "Draw recurring raffle", "0x09", {
    inputs: [recurringCampaign, { ...entry, min: 0, max: 64, data: { length: 82 } }],
    outputs: [recurringCampaign, { ...entry, min: 0, max: 64, data: { length: 82 } }],
    relations: [...campaignIdentity, preserve("capacity"), preserve("data", 0, 61), preserve("data", 62, 112)],
    // FON's recurring draw validates each output lock, capacity and participant
    // against its input, including sorted winner order and exact reward amounts.
  }, true);
  add("claim-recurring-raffle", "Claim raffle reward", "0x0a", {
    inputs: [recurringCampaign, { ...ownEntry, data: { ...ownEntry.data, length: 82 } }], outputs: [recurringCampaign],
    relations: [...campaignIdentity, ...entryCampaign, preserve("data", 0, 53), preserve("data", 62, 112)],
  });
  add("rollover-recurring-raffle", "Roll over raffle", "0x0b", {
    inputs: [recurringCampaign], outputs: [recurringCampaign],
    relations: [...campaignIdentity, preserve("capacity"), preserve("data", 0, 53), preserve("data", 70, 104)],
  });
  add("reclaim-recurring-participant", "Reclaim raffle entry", "0x0c", {
    inputs: [recurringCampaign, { ...ownEntry, data: { ...ownEntry.data, length: 82 } }], outputs: [recurringCampaign],
    relations: [...campaignIdentity, ...entryCampaign, preserve("capacity"), preserve("data")],
  });
  return policies;
}
