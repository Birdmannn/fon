import { ccc } from "@ckb-ccc/core";
import { parsePilotWalletDescriptor, pilotWalletLock, type PilotCellPolicy } from "@owl/pilot";
import { FREIGHT_PERMISSIONS, FREIGHT_TRANSACTION_PERMISSIONS, type FreightTransactionPermission } from "./owlPermissions.ts";
import { mergePilotPolicyCatalog, ZERO_HASH } from "./pilotProtocol.ts";

/** Build rules from application effects, before Pilot adds its authority/change/pool cells. */
export async function freightTransactionPolicies(options: {
  client: ccc.Client;
  account: unknown;
  permission: FreightTransactionPermission;
  transaction: ccc.TransactionLike;
  /** Exact data is the default. Mutable app state must explicitly request arbitrary data. */
  data?: "exact" | "any";
  /** Optional reviewed ceiling for changing capacity; defaults to each cell's capacity. */
  maxCapacity?: bigint;
}): Promise<PilotCellPolicy[]> {
  const { client, permission } = options;
  if (!FREIGHT_TRANSACTION_PERMISSIONS.includes(permission)) throw new Error("Cell policies require a transaction permission.");
  const account = parsePilotWalletDescriptor(options.account);
  const walletLock = pilotWalletLock(account);
  const authorityType = ccc.Script.from(account.stateType);
  const poolLock = ccc.Script.from(account.poolLock);
  const ownerLock = ccc.Script.from(account.ownerLock);
  const tx = ccc.Transaction.from(options.transaction);
  const label = FREIGHT_PERMISSIONS.find(([id]) => id === permission)![1];
  const policies: PilotCellPolicy[] = [];
  const add = (direction: "input" | "output", cell: ccc.CellOutput, data: ccc.Hex, index: number) => {
    const maximum = options.maxCapacity ?? cell.capacity;
    if (maximum < cell.capacity || maximum <= 0n || maximum > 0xffffffffffffffffn) throw new Error("Invalid cell-policy capacity ceiling.");
    policies.push({ name: `${label}: ${direction} ${index + 1}`, direction,
      lockHash: cell.lock.hash(), typeHash: cell.type?.hash() ?? ZERO_HASH,
      dataHash: options.data === "any" ? ZERO_HASH : ccc.hashCkb(data), maxCapacity: maximum.toString() });
  };
  for (const [index, input] of tx.inputs.entries()) {
    const cell = await client.getCellLive(input.previousOutput, true, true);
    if (!cell) throw new Error("Cannot approve a transaction whose input is no longer live.");
    if (cell.cellOutput.lock.eq(ownerLock) || cell.cellOutput.lock.eq(poolLock) || cell.cellOutput.type?.eq(authorityType)) {
      throw new Error("Provide app effects before wallet preparation; owner, pool and authority inputs are wallet-managed.");
    }
    // Other input locks enforce their own rules. Pilot policies cover its own assets.
    if (cell.cellOutput.lock.eq(walletLock) && (cell.cellOutput.type || cell.outputData !== "0x")) {
      add("input", cell.cellOutput, cell.outputData, index);
    }
  }
  for (const [index, cell] of tx.outputs.entries()) {
    const data = tx.outputsData[index];
    if (data === undefined) throw new Error("Missing app output data.");
    if (cell.lock.eq(poolLock) || cell.type?.eq(authorityType)) throw new Error("Pool and authority outputs are wallet-managed.");
    if (cell.lock.eq(walletLock) && !cell.type && data === "0x") continue;
    add("output", cell, data, index);
  }
  return mergePilotPolicyCatalog(policies);
}
