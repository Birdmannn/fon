import type { ccc } from "@ckb-ccc/connector-react";
import { FreightPilotSigner } from "./pilotWallet.ts";

// Each signed action is separately selectable. Hosted Pilot maps these to scoped
// grants, with additional exact cell/recipient policies for transaction effects.
export const FREIGHT_PERMISSIONS = [
  ["create-campaign", "Publish freight", "Create and fund a freight cell."],
  ["approve-campaign", "Approve freight", "Record your tagged approval on-chain."],
  ["confirm-raffle-approval", "Confirm raffle approval", "Confirm the approved raffle can commence."],
  ["cancel-campaign", "Cancel freight", "Cancel an eligible freight."],
  ["gift-claim", "Claim a gift", "Claim an eligible gift allocation."],
  ["deposit", "Deposit support", "Deposit CKB into freight and sign its support receipt."],
  ["creator-tip", "Tip a creator", "Send CKB directly to a creator's wallet."],
  ["buy-tickets", "Buy raffle tickets", "Pay CKB and create or update your raffle entry."],
  ["update-campaign-status", "Update freight status", "Advance an eligible freight to its next status."],
  ["batch-deliver", "Deliver rewards", "Distribute freight rewards to participants."],
  ["creator-withdraw", "Withdraw support", "Withdraw eligible creator funds and sign its receipt."],
  ["draw-recurring-raffle", "Draw recurring raffle", "Settle a recurring raffle round."],
  ["claim-recurring-raffle", "Claim raffle reward", "Claim your recurring raffle winnings."],
  ["rollover-recurring-raffle", "Roll over raffle", "Start the next recurring raffle round."],
  ["reclaim-recurring-participant", "Reclaim raffle entry", "Recover capacity from an eligible raffle entry."],
  ["wallet-seed", "Create Freight profile", "Sign the proof that initializes your Freight profile."],
  ["marquee-edit", "Edit profile marquee", "Sign changes to your public profile text."],
  ["profile-photo", "Update profile photo", "Sign the digest of your uploaded photo."],
  ["interaction-like", "Like freight", "Sign a freight like or unlike."],
  ["interaction-comment", "Comment on freight", "Sign a new freight comment."],
  ["interaction-reshare", "Reshare freight", "Sign a freight reshare."],
  ["freight-tree", "Manage freight tree", "Sign freight tree changes."],
  ["google-identity-link", "Link Google identity", "Prove wallet ownership when linking Google."],
  ["google-forms-link", "Link Google Forms access", "Prove wallet ownership for Google Forms response access."],
  ["google-forms-access", "Read mounted Google Forms", "Sign access to mounted form responses."],
  ["forms-claim", "Claim a form response", "Sign a form response claim."],
  ["forms-sync", "Sync form responses", "Sign a request to sync form responses."],
  ["forms-review", "Review form claims", "Sign a review of form response claims."],
] as const;

export type FreightPermission = typeof FREIGHT_PERMISSIONS[number][0];
export type PermissionHandler = <T>(signer: ccc.Signer, permission: FreightPermission, operation: (activeSigner: ccc.Signer) => Promise<T>) => Promise<T>;
let handler: PermissionHandler | undefined;

export function installPermissionHandler(next: PermissionHandler) {
  handler = next;
  return () => { if (handler === next) handler = undefined; };
}

export function resolveFreightPermission(id: string): FreightPermission {
  const permission = FREIGHT_PERMISSIONS.find(([candidate]) => candidate === id);
  if (!permission) throw new Error(`Unknown Freight signing permission: ${id}`);
  return permission[0];
}

export function withFreightPermission<T>(signer: ccc.Signer, id: string, operation: (activeSigner: ccc.Signer) => Promise<T>): Promise<T> {
  const permission = resolveFreightPermission(id);
  if (!handler) return Promise.reject(new Error("Open Owl and select signing permissions first."));
  return handler(signer, permission, operation);
}

export function signFreightMessage(signer: ccc.Signer, permission: string, message: Parameters<ccc.Signer["signMessage"]>[0]) {
  return withFreightPermission(signer, permission, (activeSigner) => {
    if (activeSigner instanceof FreightPilotSigner) {
      if (typeof message !== "string") throw new Error("Freight scoped messages must be text.");
      return activeSigner.signFreightScope(resolveFreightPermission(permission), message);
    }
    return activeSigner.signMessage(message);
  });
}

export function sendFreightTransaction(signer: ccc.Signer, permission: FreightPermission, tx: ccc.Transaction) {
  return withFreightPermission(signer, permission, (activeSigner) => activeSigner instanceof FreightPilotSigner
    ? activeSigner.sendFreightEffects(permission, tx) : activeSigner.sendTransaction(tx));
}
