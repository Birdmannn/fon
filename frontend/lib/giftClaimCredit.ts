import { Address } from "@ckb-ccc/core";
import { getPublicCkbClient } from "@/lib/ckbClient";
import { FREIGHT_CONTRACT } from "@/lib/contract";
import { getCampaignStableId } from "@/lib/campaignIdentity";
import { bytesToHex, decodeCampaignData, hexToBytes } from "@/lib/encoding";
import type { GiftPolicy } from "@/lib/giftPolicy";

export function claimedGiftAmount(before: GiftPolicy, after: GiftPolicy, walletHash: string): string {
  if (before.slots.length !== after.slots.length) throw new Error("Gift allocations changed");
  const newlyClaimed = after.slots.filter((slot, index) => slot.claimed && !before.slots[index].claimed);
  if (newlyClaimed.length !== 1 || bytesToHex(newlyClaimed[0].claimant) !== walletHash.toLowerCase()) {
    throw new Error("Transaction did not claim this wallet's gift");
  }
  const index = after.slots.indexOf(newlyClaimed[0]);
  if (newlyClaimed[0].amount !== before.slots[index].amount) throw new Error("Gift amount changed");
  return newlyClaimed[0].amount.toString();
}

export async function verifyGiftClaimCredit(txHash: string, address: string, campaignId: string) {
  const client = getPublicCkbClient();
  const receipt = await client.getTransaction(txHash);
  if (!receipt || receipt.status !== "committed") throw new Error("Gift claim is not confirmed");
  const tx = receipt.transaction;
  const output = tx.outputs[0];
  if (!output?.type || output.type.codeHash !== FREIGHT_CONTRACT.codeHash || output.type.hashType !== FREIGHT_CONTRACT.hashType) {
    throw new Error("Gift claim uses a different freight contract");
  }
  const previous = tx.inputs[0]?.previousOutput;
  if (!previous) throw new Error("Missing gift input");
  const original = await client.getTransaction(previous.txHash);
  const inputIndex = Number(previous.index);
  const input = original?.transaction.outputs[inputIndex];
  if (!original || !input?.type?.eq(output.type)) throw new Error("Missing original gift freight");
  const before = decodeCampaignData(hexToBytes(original.transaction.outputsData[inputIndex]));
  const after = decodeCampaignData(hexToBytes(tx.outputsData[0]));
  if (!before.gift || !after.gift || getCampaignStableId({ data: before, outPoint: { txHash: previous.txHash } }) !== campaignId.toLowerCase()
    || getCampaignStableId({ data: after, outPoint: { txHash } }) !== campaignId.toLowerCase()) throw new Error("Gift freight does not match");
  const wallet = await Address.fromString(address, client);
  const amount = claimedGiftAmount(before.gift, after.gift, wallet.script.hash());
  if (!tx.outputs[1]?.lock.eq(wallet.script) || tx.outputs[1].capacity < BigInt(amount)) throw new Error("Missing gift payout");
  return amount;
}
