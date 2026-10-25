import { Address, Script, type Client } from "@ckb-ccc/core";
import { parsePilotWalletDescriptor, pilotWalletLock } from "@owl/pilot";

import { buildStableCampaignId } from "@/lib/campaignIdentity";
import { CampaignStatus, FREIGHT_CONTRACT, Selector } from "@/lib/contract";
import { bytesToHex, decodeCampaignData, hexToBytes, lockScriptToAddressBytes } from "@/lib/encoding";

export async function verifyFreightCreateProof(client: Client, txHash: string, address: string, campaignId: string, pilotAccount?: unknown) {
  const response = await client.getTransaction(txHash);
  if (!response || response.status !== "committed") return false;

  const profileLock = (await Address.fromString(address, client)).script;
  const account = pilotAccount === undefined ? null : parsePilotWalletDescriptor(pilotAccount);
  if (account && !Script.from(account.ownerLock).eq(profileLock)) {
    throw new Error("Pilot owner does not match the FBARS profile");
  }
  const creatorLock = account ? pilotWalletLock(account) : profileLock;
  const creatorHash = bytesToHex(lockScriptToAddressBytes(creatorLock));
  const transaction = response.transaction;
  const output = transaction.outputs[0];
  const type = output?.type;
  const expectedLock = Script.from({
    codeHash: FREIGHT_CONTRACT.codeHash,
    hashType: FREIGHT_CONTRACT.hashType,
    args: `0xff${creatorHash.slice(2)}`,
  });
  if (!output || !type
    || type.codeHash.toLowerCase() !== FREIGHT_CONTRACT.codeHash.toLowerCase()
    || type.hashType !== FREIGHT_CONTRACT.hashType
    || hexToBytes(type.args)[0] !== Selector.CreateCampaign
    || !output.lock.eq(expectedLock)) {
    throw new Error("Transaction does not create a freight for this wallet");
  }

  const campaign = decodeCampaignData(hexToBytes(transaction.outputsData[0] ?? "0x"));
  if (campaign.status !== CampaignStatus.Created
    || campaign.currentDeposits !== 0n
    || bytesToHex(campaign.createdBy) !== creatorHash
    || buildStableCampaignId(creatorHash, campaign.createdAt, campaign.campaignType) !== campaignId.toLowerCase()) {
    throw new Error("Transaction does not match this freight");
  }

  for (const input of transaction.inputs) {
    const cell = await input.getCell(client);
    if (cell?.cellOutput.lock.eq(creatorLock)) return true;
  }
  throw new Error("The creator wallet did not sign an input of this transaction");
}
