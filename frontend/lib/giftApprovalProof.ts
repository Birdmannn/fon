import type { Client } from "@ckb-ccc/core";
import { buildStableCampaignId } from "./campaignIdentity";
import { CampaignType, FREIGHT_CONTRACT } from "./contract";
import { bytesToHex, decodeCampaignData, hexToBytes, type CampaignData } from "./encoding";

function identity(data: CampaignData) {
  return buildStableCampaignId(bytesToHex(data.createdBy), data.createdAt, data.campaignType);
}

// Resolve the exact creation script, then find the current unspent campaign.
// No approval flags from MongoDB or the request are accepted as proof.
export async function getLiveGiftCampaign(client: Client, record: Record<string, unknown>): Promise<CampaignData> {
  const expectedId = buildStableCampaignId(
    typeof record.createdByHash === "string" ? record.createdByHash : null,
    typeof record.chainCreatedAt === "string" ? record.chainCreatedAt : null,
    typeof record.campaignType === "number" ? record.campaignType : null,
  );
  if (!expectedId || record.campaignType !== CampaignType.FundedTask || typeof record.txHash !== "string") throw new Error("Gift has no matching on-chain identity");
  const creation = await client.getTransaction(record.txHash);
  const type = creation?.transaction.outputs[0]?.type;
  if (creation?.status !== "committed" || !type || type.codeHash !== FREIGHT_CONTRACT.codeHash || type.hashType !== FREIGHT_CONTRACT.hashType) throw new Error("Gift creation is not confirmed on the configured contract");
  const initial = decodeCampaignData(hexToBytes(creation.transaction.outputsData[0]));
  if (identity(initial) !== expectedId) throw new Error("Gift creation belongs to a different freight");
  for await (const cell of client.findCellsByType(type, true, "desc", 1000)) {
    const data = decodeCampaignData(hexToBytes(cell.outputData));
    if (identity(data) !== expectedId) continue;
    const receipt = await client.getTransaction(cell.outPoint.txHash);
    if (receipt?.status !== "committed") throw new Error("Wait for the gift approval transaction to be confirmed");
    if (data.approval && data.approval.stage !== "gift-commence") throw new Error("Invalid gift approval stage");
    return data;
  }
  throw new Error("Unable to find the live gift freight on-chain");
}
