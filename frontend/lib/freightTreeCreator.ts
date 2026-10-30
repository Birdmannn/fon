import { Address, type Client } from "@ckb-ccc/core";
import { buildStableCampaignId } from "./campaignIdentity";
import { campaignCreatorAddress, campaignPublication, type CampaignPublication } from "./campaignCreatorIdentity";
import { bytesToHex, lockScriptToAddressBytes } from "./encoding";

type CreatorRecord = {
  campaignId: string; createdByHash?: string; chainCreatedAt?: string;
  campaignType?: number; creatorAddress?: string; txHash?: string;
};

/** Authorize the profile identity without changing the freight's chain identity. */
export async function verifyFreightTreeCreator(client: Client, row: CreatorRecord, publications: readonly CampaignPublication[]) {
  const address = campaignCreatorAddress(row, publications).trim().toLowerCase();
  const stableId = buildStableCampaignId(row.createdByHash, row.chainCreatedAt, row.campaignType);
  if (!address || !stableId || stableId !== row.campaignId.toLowerCase()) {
    throw new Error("Freight creator identity is incomplete");
  }
  const parsed = await Address.fromString(address, client);
  const creator = row.createdByHash?.toLowerCase();
  if (bytesToHex(lockScriptToAddressBytes(parsed.script)) === creator) return address;

  // Pilot spending locks begin with the owner's full lock hash, while FON's
  // creator field stores the first 20 bytes. The publication receipt proved
  // that exact owner/account relationship against the committed transaction.
  // A hash-prefix match alone must never establish ownership from editable metadata.
  if (campaignPublication(row, publications) && parsed.script.hash().slice(0, 42) === creator) return address;
  throw new Error("Freight creator address does not match its on-chain identity");
}
