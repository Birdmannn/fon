import { Address, type Client } from "@ckb-ccc/core";

import { getRecordStableId } from "@/lib/campaignIdentity";
import { CampaignType, FREIGHT_CONTRACT } from "@/lib/contract";
import { bytesToHex, decodeCampaignData, hexToBytes, lockScriptToAddressBytes } from "@/lib/encoding";

type TipRecord = {
  campaignId?: string | null;
  createdByHash?: string | null;
  chainCreatedAt?: string | null;
  campaignType?: number | null;
  creatorAddress?: string | null;
};

export async function verifyCreatorTip(
  client: Client,
  txHash: string,
  payerAddress: string,
  record: TipRecord,
  expectedAmountShannons: bigint,
): Promise<boolean> {
  const response = await client.getTransaction(txHash);
  if (!response || response.status !== "committed") return false;
  if (record.campaignType !== CampaignType.SimpleTask || !record.creatorAddress) {
    throw new Error("This freight does not accept direct creator tips");
  }

  const tx = response.transaction;
  const campaignInput = await tx.inputs[0]?.getCell(client);
  const campaignOutput = tx.outputs[0];
  const campaignType = campaignInput?.cellOutput.type;
  if (!campaignInput || !campaignOutput || !campaignType
    || campaignType.codeHash.toLowerCase() !== FREIGHT_CONTRACT.codeHash.toLowerCase()
    || campaignType.hashType !== FREIGHT_CONTRACT.hashType
    || !campaignOutput.type?.eq(campaignType)
    || !campaignOutput.lock.eq(campaignInput.cellOutput.lock)
    || campaignOutput.capacity !== campaignInput.cellOutput.capacity) {
    throw new Error("Transaction does not preserve this freight's cell");
  }

  const before = decodeCampaignData(hexToBytes(campaignInput.outputData));
  const after = decodeCampaignData(hexToBytes(tx.outputsData[0] ?? "0x"));
  const recordId = getRecordStableId(record);
  const beforeId = `${bytesToHex(before.createdBy)}:${before.createdAt}:${before.campaignType}`;
  const afterId = `${bytesToHex(after.createdBy)}:${after.createdAt}:${after.campaignType}`;
  if (!recordId || beforeId !== recordId || afterId !== recordId
    || after.currentDeposits - before.currentDeposits !== expectedAmountShannons) {
    throw new Error("Transaction does not record this tip on the selected freight");
  }

  const creatorLock = (await Address.fromString(record.creatorAddress, client)).script;
  if (bytesToHex(lockScriptToAddressBytes(creatorLock)) !== bytesToHex(before.createdBy)
    || !tx.outputs[1]?.lock.eq(creatorLock)
    || tx.outputs[1].capacity !== expectedAmountShannons) {
    throw new Error("Transaction does not pay the freight creator the stated amount");
  }

  const payerLock = (await Address.fromString(payerAddress, client)).script;
  for (const input of tx.inputs.slice(1)) {
    const cell = await input.getCell(client);
    if (cell?.cellOutput.lock.eq(payerLock)) return true;
  }
  throw new Error("The tip was not paid by this wallet");
}
