import { ccc } from "@ckb-ccc/core";
import { PilotHostedSigner, type PilotCellPolicy, type PilotScopedMessage, type PilotWalletJournal } from "@owl/pilot";
import { FREIGHT_PERMISSIONS, type FreightPermission } from "./owlPermissions.ts";
import { FREIGHT_CONTRACT } from "./contract.ts";
import { FREIGHT_PILOT_PROTOCOL, ZERO_HASH, freightPilotChallenge, freightPilotScope, type FreightPilotProof } from "./pilotProtocol.ts";

export class PilotPolicyReviewRequired extends Error {
  readonly policies: PilotCellPolicy[];
  constructor(policies: PilotCellPolicy[]) {
    super("Approve these Freight cells and recipients in Pilot before automatic signing.");
    this.policies = policies;
  }
}

interface Submission {
  account: string; requestId: string; effectHash: ccc.Hex; bytes: ccc.Hex; hash?: ccc.Hex;
}

/** Only public prepared bytes and request IDs are stored on Freight's origin. */
export class FreightPilotSigner extends PilotHostedSigner {
  private get storageKey() { return `freight:pilot:submission:v1:${this.provider.account!.address}`; }

  async signFreightScope(permission: FreightPermission, message: string) {
    const connection = this.provider.account;
    if (!connection || !this.provider.connected) throw new Error("Reconnect the Pilot wallet.");
    const challenge = freightPilotChallenge(message, connection.address, permission);
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

  async sendFreightEffects(permission: FreightPermission, value: ccc.Transaction): Promise<ccc.Hex> {
    if (!this.provider.connected) throw new Error("Reconnect the Pilot wallet.");
    const effectHash = ccc.hashCkb(value.toBytes());
    const saved = this.pending();
    if (saved?.effectHash === effectHash) return saved.hash ?? (await this.resumeFreightSubmission())!;
    if (saved && !saved.hash) throw new Error("A Pilot transaction is unresolved. Retry the saved transaction from Owl permissions before starting another.");
    const journal = await this.provider.request("logs") as PilotWalletJournal;
    if (!journal.state || journal.stopped) throw new Error("Reconnect and approve a Pilot session.");
    if (!journal.state.policies.some(policy => policy.direction === "message" && policy.lockHash === ccc.hashCkb(ccc.bytesFrom(freightPilotScope(permission), "utf8")))) {
      throw new Error("This action was not selected in the Pilot wallet. Review your session permissions.");
    }
    const required = await this.effectPolicies(permission, value, 0n);
    if (required.some(policy => !journal.state!.policies.some(allowed =>
      allowed.direction === policy.direction && allowed.lockHash === policy.lockHash && allowed.typeHash === policy.typeHash &&
      (allowed.dataHash === ZERO_HASH || allowed.dataHash === policy.dataHash) && BigInt(allowed.maxCapacity) >= BigInt(policy.maxCapacity)))) {
      throw new PilotPolicyReviewRequired(await this.effectPolicies(permission, value, BigInt(journal.state.remaining)));
    }
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

  private async effectPolicies(permission: FreightPermission, tx: ccc.Transaction, remaining: bigint): Promise<PilotCellPolicy[]> {
    const accountLock = (await this.getRecommendedAddressObj()).script;
    const name = FREIGHT_PERMISSIONS.find(([id]) => id === permission)![1];
    const policies: PilotCellPolicy[] = [];
    const add = (output: ccc.CellOutput, data: ccc.Hex, direction: "input" | "output") => {
      if (output.lock.eq(accountLock) && !output.type && data === "0x") return;
      const freight = output.type?.codeHash === FREIGHT_CONTRACT.codeHash && output.type.hashType === FREIGHT_CONTRACT.hashType;
      policies.push({
        name: `${name}: ${direction === "input" ? "use asset" : freight ? "update freight data" : "pay recipient"}`.slice(0, 100),
        direction, lockHash: output.lock.hash(), typeHash: output.type?.hash() ?? ZERO_HASH,
        // Freight's type script enforces its state transitions. Other asset data
        // remains pinned to these exact bytes; recipient lock/type always match.
        dataHash: freight ? ZERO_HASH : ccc.hashCkb(data),
        maxCapacity: (freight ? output.capacity + remaining : output.capacity).toString(),
      });
    };
    tx.outputs.forEach((output, index) => add(output, tx.outputsData[index], "output"));
    for (const input of tx.inputs) {
      const cell = await this.client.getCellLive(input.previousOutput, true);
      if (!cell) throw new Error("A Freight transaction input is no longer live.");
      if (cell.cellOutput.lock.eq(accountLock) && (cell.cellOutput.type || cell.outputData !== "0x")) add(cell.cellOutput, cell.outputData, "input");
    }
    return policies;
  }
}

export async function completeFreightFee(tx: ccc.Transaction, signer: ccc.Signer, feeRate: bigint) {
  if (!(signer instanceof FreightPilotSigner)) await tx.completeFeeBy(signer, feeRate);
}
