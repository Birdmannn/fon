import type { Client } from "@ckb-ccc/core";
import type { CampaignRecord } from "../app/_types/campaignRecords";
import { FREIGHT_CONTRACT } from "./contract";
import { buildStableCampaignId } from "./campaignIdentity";
import { bytesToHex, decodeCampaignData, hexToBytes } from "./encoding";
import { isOnChainGiftApprovalSatisfied } from "./giftApproval";
import { raffleApprovalsSatisfied } from "./raffleApproval";

export type ApprovalConstraintRecord = Pick<CampaignRecord,
  "campaignId" | "createdByHash" | "chainCreatedAt" | "campaignType" | "giftDeliverable" | "raffleApproval">;

/** Approval constraints follow the live contract, not editable approval labels. */
export async function freightApprovalConstraintSatisfied(client: Client, record: ApprovalConstraintRecord) {
  if (!record.raffleApproval && !(record.giftDeliverable?.enabled && record.giftDeliverable.approvers.length)) return true;
  if (!/^0x[0-9a-f]{40}$/i.test(record.createdByHash ?? "")) return false;
  const identity = buildStableCampaignId(record.createdByHash, record.chainCreatedAt, record.campaignType);
  if (!identity || identity !== record.campaignId?.toLowerCase()) return false;
  for await (const cell of client.findCells({
    script: {codeHash: FREIGHT_CONTRACT.codeHash, hashType: FREIGHT_CONTRACT.hashType,
      args: `0xff${record.createdByHash!.slice(2)}`},
    scriptType: "lock", scriptSearchMode: "exact", withData: true,
  }, "desc", 100)) {
    const type = cell.cellOutput.type;
    if (!type || type.codeHash !== FREIGHT_CONTRACT.codeHash || type.hashType !== FREIGHT_CONTRACT.hashType) continue;
    let campaign;
    try {campaign = decodeCampaignData(hexToBytes(cell.outputData));} catch {continue;}
    if (buildStableCampaignId(bytesToHex(campaign.createdBy), campaign.createdAt, campaign.campaignType) !== identity) continue;
    return record.raffleApproval
      ? !!campaign.approval && raffleApprovalsSatisfied(campaign.approval)
      : isOnChainGiftApprovalSatisfied(record.giftDeliverable, campaign.approval);
  }
  return false;
}
