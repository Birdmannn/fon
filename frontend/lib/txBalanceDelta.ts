import { Address } from "@ckb-ccc/core";

import { getPublicCkbClient } from "@/lib/ckbClient";

function normalizeTxHash(value: string) {
  return value.trim().toLowerCase();
}

export async function getAddressNetDeltaShannons(txHash: string, address: string): Promise<string | null> {
  const normalizedTxHash = normalizeTxHash(txHash);
  if (!normalizedTxHash) {
    return null;
  }

  const client = getPublicCkbClient();
  const addressObj = await Address.fromString(address, client);
  const targetScript = addressObj.script;
  const tx = await client.getTransaction(normalizedTxHash);
  if (!tx) {
    return null;
  }

  const outputTotal = tx.transaction.outputs.reduce((sum, output) => {
    return output.lock.eq(targetScript) ? sum + BigInt(output.capacity) : sum;
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

  const inputTotal = inputCells.reduce((sum, cell) => {
    if (!cell) {
      return sum;
    }

    return cell.cellOutput.lock.eq(targetScript) ? sum + BigInt(cell.cellOutput.capacity) : sum;
  }, 0n);

  return (outputTotal - inputTotal).toString();
}

export async function getAddressNetDeltaMap(txHashes: string[], address: string) {
  const uniqueTxHashes = Array.from(new Set(txHashes.map(normalizeTxHash).filter(Boolean)));
  const entries = await Promise.all(
    uniqueTxHashes.map(async (txHash) => [txHash, await getAddressNetDeltaShannons(txHash, address)] as const)
  );

  return Object.fromEntries(entries) as Record<string, string | null>;
}
