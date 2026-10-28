import { ccc } from "@ckb-ccc/core";
import type { CampaignCell } from "./transactions";
import { getCampaignStableId } from "./campaignIdentity";
import { decodeCampaignData, hexToBytes } from "./encoding";

/** A feed/modal snapshot can point at the cell consumed by an earlier activation or purchase. */
export async function resolveLiveRaffleCampaign(client: ccc.Client, snapshot: CampaignCell, preferred?: ccc.OutPointLike): Promise<CampaignCell> {
  const identity = getCampaignStableId(snapshot);
  const read = async (point: ccc.OutPointLike): Promise<CampaignCell | null> => {
    const cell = await client.getCellLive(point, true, true);
    if (!cell?.cellOutput.type || !cell.cellOutput.lock.eq(snapshot.lock)
      || !cell.cellOutput.type.eq(snapshot.type)) return null;
    let data;
    try { data = decodeCampaignData(hexToBytes(cell.outputData)); }
    catch { return null; }
    const campaign: CampaignCell = {
      outPoint: { txHash: cell.outPoint.txHash, index: Number(cell.outPoint.index) },
      data, capacityShannons: cell.cellOutput.capacity,
      lock: cell.cellOutput.lock, type: cell.cellOutput.type,
    };
    return getCampaignStableId(campaign) === identity ? campaign : null;
  };
  if (preferred) {
    const campaign = await read(preferred);
    if (campaign) return campaign;
  }
  const current = await read(snapshot.outPoint);
  if (current) return current;
  for await (const candidate of client.findCells({
    script: snapshot.type, scriptType: "type", scriptSearchMode: "exact", withData: true,
  }, "desc", 100)) {
    const campaign = await read(candidate.outPoint);
    if (campaign) return campaign;
  }
  throw new Error("This raffle changed on-chain, but its live cell is not available yet. Refresh the freight and try again.");
}

export async function confirmRaffleActivation(client: ccc.Client, snapshot: CampaignCell, txHash: string) {
  const confirmation = await client.waitTransaction(txHash, 1, 180_000);
  if (confirmation?.status !== "committed") throw new Error("Raffle activation is still unconfirmed. Please wait before buying tickets.");
  return resolveLiveRaffleCampaign(client, snapshot, { txHash, index: 0 });
}
