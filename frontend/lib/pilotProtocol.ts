import { ccc } from "@ckb-ccc/core";
import { MAX_ACTION_CATALOG, MAX_DELEGATED_ACTIONS, validatePilotPolicyCatalog } from "@owl/pilot";
import type { PilotCellPolicy, PilotScopedMessage, PilotWalletDescriptor, PilotWalletState } from "@owl/pilot";
import { FREIGHT_PERMISSIONS, FREIGHT_MESSAGE_PERMISSIONS, resolveFreightMessagePermission, type FreightPermission, type FreightMessagePermission } from "./owlPermissions.ts";

export const FREIGHT_PILOT_PROTOCOL = "freight-pilot-scoped-v1";
export const ZERO_HASH = `0x${"00".repeat(32)}` as ccc.Hex;
export const freightPilotScope = (permission: FreightPermission) => `freight.${permission}`;

export const isOwnerProfilePermission = (permission: FreightPermission) => [
  "wallet-seed", "marquee-edit", "profile-photo", "google-identity-link", "google-forms-link", "freight-tree",
].includes(permission);

export interface FreightPilotProof {
  protocol: typeof FREIGHT_PILOT_PROTOCOL;
  account: PilotWalletDescriptor;
  state: PilotWalletState;
  proof: PilotScopedMessage;
}

export function freightMessagePolicy(permission: FreightMessagePermission): PilotCellPolicy {
  resolveFreightMessagePermission(permission);
  const name = permission === "deposit" ? "Sign support receipt"
    : permission === "creator-withdraw" ? "Sign withdrawal receipt"
    : FREIGHT_PERMISSIONS.find(([id]) => id === permission)![1];
  return {
    name,
    direction: "message", lockHash: ccc.hashCkb(ccc.bytesFrom(freightPilotScope(permission), "utf8")),
    typeHash: ZERO_HASH, dataHash: ZERO_HASH, maxCapacity: "1",
  };
}

/** Transaction permissions describe effects or a committed whole-action template. */
export function freightPilotCatalog(cellPolicies: readonly PilotCellPolicy[] = []) {
  if (cellPolicies.some(policy => policy.direction === "message")) {
    throw new Error("Transaction policies must describe input or output cells or transaction templates.");
  }
  const catalog = mergePilotPolicyCatalog(FREIGHT_MESSAGE_PERMISSIONS.map(freightMessagePolicy), cellPolicies);
  validatePilotPolicyCatalog(catalog);
  return catalog;
}

// Recover the server-issued challenge from the complete signed message. A photo
// appends its content digest; Google has a different, purpose-qualified prefix.
export function freightPilotChallenge(message: string, address: string, permission: FreightPermission) {
  const normalized = address.trim().toLowerCase();
  const prefix = permission === "google-identity-link" || permission === "google-forms-link"
    ? `freight-google-link:${permission === "google-identity-link" ? "identity_link" : "forms_response_access"}:${normalized}:`
    : `freight-${permission}:${normalized}:`;
  if (!message.startsWith(prefix)) throw new Error("Message does not match this account and action.");
  const suffix = message.slice(prefix.length).split(":");
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(suffix[0]) ||
      (permission === "profile-photo" ? suffix.length !== 2 || !/^[a-f0-9]{64}$/.test(suffix[1]) : suffix.length !== 1)) {
    throw new Error("Invalid Freight signing challenge.");
  }
  return { nonce: suffix[0], issuedMessage: prefix + suffix[0] };
}

export function freightPermissionFromPurpose(purpose: string) {
  if (purpose === "identity_link") return "google-identity-link";
  if (purpose === "forms_response_access") return "google-forms-link";
  return resolveFreightMessagePermission(purpose);
}

export function mergePilotPolicies(...groups: readonly (readonly PilotCellPolicy[])[]): PilotCellPolicy[] {
  return mergePolicies(MAX_DELEGATED_ACTIONS, groups);
}

export function mergePilotPolicyCatalog(...groups: readonly (readonly PilotCellPolicy[])[]): PilotCellPolicy[] {
  return mergePolicies(MAX_ACTION_CATALOG, groups);
}

function mergePolicies(limit: number, groups: readonly (readonly PilotCellPolicy[])[]): PilotCellPolicy[] {
  const result: PilotCellPolicy[] = [];
  for (const policy of groups.flat()) {
    const existing = result.find(row => row.direction === policy.direction && row.lockHash === policy.lockHash && row.typeHash === policy.typeHash && row.dataHash === policy.dataHash);
    if (existing) {
      if (BigInt(policy.maxCapacity) > BigInt(existing.maxCapacity)) existing.maxCapacity = policy.maxCapacity;
    } else result.push({ ...policy });
  }
  if (result.length > limit) throw new Error(`Pilot supports ${limit} policies ${limit === MAX_DELEGATED_ACTIONS ? "per session" : "in the catalog"}. Select fewer actions or recipients before approving this transaction.`);
  return result;
}
