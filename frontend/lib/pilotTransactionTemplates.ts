import { ccc } from "@ckb-ccc/core";
import { pilotTemplatePolicy, type PilotScriptPattern, type PilotTemplateCell, type PilotTemplateField, type PilotTransactionTemplate } from "@owl/pilot";
import { FREIGHT_CONTRACT } from "./contract";

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

/** Whole-transaction rules; all other application inputs/outputs are rejected. */
export function freightTransactionTemplates() {
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
  // Freight's deployed contract validates raffle kind, ticket/campaign identity,
  // price accounting and every entry's identity/round. Template relations do not
  // provide an arithmetic interpreter or a forall over repeated entry roles.
  return [pilotTemplatePolicy("Publish freight", publish),
    pilotTemplatePolicy("Update freight status (includes raffle activation)", status),
    pilotTemplatePolicy("Buy raffle tickets", buy)];
}
