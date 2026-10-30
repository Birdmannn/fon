import { Address, type Client } from "@ckb-ccc/core";

import { getPublicCkbClient } from "@/lib/ckbClient";
import { isProfileHistoryScript } from "./profileHistoryIdentity";

function normalizeTxHash(value: string) {
  return value.trim().toLowerCase();
}

export async function getAddressNetDeltaShannons(txHash: string, address: string | readonly string[], client: Client = getPublicCkbClient()): Promise<string | null> {
  const normalizedTxHash = normalizeTxHash(txHash);
  if (!normalizedTxHash) {
    return null;
  }

  const addresses = typeof address === "string" ? [address] : [...new Set(address)];
  const scripts = await Promise.all(addresses.map(async value => (await Address.fromString(value, client)).script));
  const matches = (script: typeof scripts[number]) => scripts.some(owner => isProfileHistoryScript(owner, script));
  const tx = await client.getTransaction(normalizedTxHash).catch(() => null);
  if (!tx) {
    return null;
  }

  const outputTotal = tx.transaction.outputs.reduce((sum, output) => {
    return matches(output.lock) ? sum + BigInt(output.capacity) : sum;
  }, 0n);

  const inputCells = await Promise.all(
    tx.transaction.inputs.map(async (input) => {
      try {
        return await input.getCell(client);
      } catch {
        return null;
      }
    })
  );

  if (inputCells.some(cell => !cell)) return null;

  const inputTotal = inputCells.reduce((sum, cell) => {
    if (!cell) {
      return sum;
    }

    return matches(cell.cellOutput.lock) ? sum + BigInt(cell.cellOutput.capacity) : sum;
  }, 0n);

  return (outputTotal - inputTotal).toString();
}

export async function getAddressNetDeltaMap(txHashes: string[], address: string | readonly string[]) {
  const uniqueTxHashes = Array.from(new Set(txHashes.map(normalizeTxHash).filter(Boolean)));
  const entries = await Promise.all(
    uniqueTxHashes.map(async (txHash) => [txHash, await getAddressNetDeltaShannons(txHash, address)] as const)
  );

  return Object.fromEntries(entries) as Record<string, string | null>;
}
