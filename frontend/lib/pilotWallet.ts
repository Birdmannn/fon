import { ccc } from "@ckb-ccc/core";
import { PilotHostedSigner, type PilotScopedMessage, type PilotWalletJournal } from "@owl/pilot";
import type { FreightPermission } from "./owlPermissions.ts";
import { FREIGHT_PILOT_PROTOCOL, freightPilotChallenge, freightPilotScope, isOwnerProfilePermission, type FreightPilotProof } from "./pilotProtocol.ts";
import { getFreightProfileAddress } from "./profileIdentity.ts";

interface Submission {
  account: string; requestId: string; effectHash: ccc.Hex; bytes: ccc.Hex; hash?: ccc.Hex;
}

/** Only public prepared bytes and request IDs are stored on Freight's origin. */
export class FreightPilotSigner extends PilotHostedSigner {
  private get storageKey() { return `freight:pilot:submission:v1:${this.provider.account!.address}`; }

  async signFreightScope(permission: FreightPermission, message: string) {
    const connection = this.provider.account;
    if (!connection || !this.provider.connected) throw new Error("Reconnect the Pilot wallet.");
    const ownerAddress = await getFreightProfileAddress(this);
    let challenge;
    try { challenge = freightPilotChallenge(message, ownerAddress, permission); }
    catch (cause) {
      if (isOwnerProfilePermission(permission)) throw cause;
      // Transaction receipts still bind the spending session address.
      challenge = freightPilotChallenge(message, connection.address, permission);
    }
    const proof = await this.provider.request("signMessage", {
      scope: freightPilotScope(permission), message, nonce: challenge.nonce,
    }) as PilotScopedMessage;
    const journal = await this.provider.request("logs") as PilotWalletJournal;
    if (!journal.state || proof.message !== message || proof.nonce !== challenge.nonce ||
        proof.scope !== freightPilotScope(permission) || proof.appOrigin !== location.origin ||
        proof.accountHash !== (await this.getRecommendedAddressObj()).script.hash()) {
      throw new Error("Pilot returned a different scoped message.");
    }
    const envelope: FreightPilotProof = { protocol: FREIGHT_PILOT_PROTOCOL, account: connection.account, state: journal.state, proof };
    return new ccc.Signature(JSON.stringify(envelope), proof.accountHash, ccc.SignerSignType.Unknown);
  }

  private pending(): Submission | undefined {
    const value = localStorage.getItem(this.storageKey);
    if (!value) return;
    const record = JSON.parse(value) as Submission;
    if (record.account !== this.provider.account?.address || !record.requestId || !record.bytes || !record.effectHash) {
      throw new Error("Invalid Pilot submission record. Reconcile the wallet receipts before continuing.");
    }
    return record;
  }

  async resumeFreightSubmission() {
    const saved = this.pending();
    if (!saved || saved.hash) return saved?.hash;
    const hash = await super.sendTransaction(ccc.Transaction.fromBytes(saved.bytes), saved.requestId);
    localStorage.setItem(this.storageKey, JSON.stringify({ ...saved, hash }));
    return hash;
  }

  async sendFreightEffects(value: ccc.Transaction): Promise<ccc.Hex> {
    if (!this.provider.connected) throw new Error("Reconnect the Pilot wallet.");
    const effectHash = ccc.hashCkb(value.toBytes());
    const saved = this.pending();
    if (saved?.effectHash === effectHash) return saved.hash ?? (await this.resumeFreightSubmission())!;
    if (saved && !saved.hash) throw new Error("A Pilot transaction is unresolved. Retry the original action to reconcile its saved transaction before starting another.");
    const journal = await this.provider.request("logs") as PilotWalletJournal;
    if (!journal.state || journal.stopped) throw new Error("Reconnect and approve a Pilot session.");
    // The wallet enforces the selected effect policies and opens its one-time
    // passkey review when needed; the app never replaces a grant to sign.
    // Preparing adds the authority and account change. Never use generic CCC
    // input/fee completion; the sponsor pays the entire network fee.
    const prepared = await super.prepareTransaction(value);
    const record: Submission = {
      account: this.provider.account!.address, effectHash, requestId: crypto.randomUUID(), bytes: ccc.hexFrom(prepared.toBytes()),
    };
    // Must succeed before any request that could sign/broadcast.
    localStorage.setItem(this.storageKey, JSON.stringify(record));
    return (await this.resumeFreightSubmission())!;
  }
}

export async function completeFreightFee(tx: ccc.Transaction, signer: ccc.Signer, feeRate: bigint) {
  if (!(signer instanceof FreightPilotSigner)) await tx.completeFeeBy(signer, feeRate);
}
