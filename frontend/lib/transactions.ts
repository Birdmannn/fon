import { ccc } from "@ckb-ccc/connector-react";
import { FREIGHT_CONTRACT, CampaignStatus, CampaignType } from "./contract";
import {
  encodeCreateCampaignArgs,
  encodeCampaignData,
  decodeCampaignData,
  bytesToHex,
  hexToBytes,
  CampaignData,
} from "./encoding";

// ─── Cell dep for the freight contract ───────────────────────────────────────

export const FREIGHT_CELL_DEP: ccc.CellDepLike = {
  outPoint: FREIGHT_CONTRACT.outPoint,
  depType: "code",
};

// ─── Build the type Script for a given selector + args ───────────────────────

export function freightScript(argsBytes: Uint8Array): ccc.ScriptLike {
  return {
    codeHash: FREIGHT_CONTRACT.codeHash,
    hashType: FREIGHT_CONTRACT.hashType,
    args: bytesToHex(argsBytes),
  };
}

// ─── create_campaign ─────────────────────────────────────────────────────────

export async function sendCreateCampaign(
  signer: ccc.Signer,
  opts: {
    startDurationSecs: bigint;
    taskDurationSecs: bigint;
    campaignType: CampaignType;
    maximumAmountCkb: bigint; // in CKB (not shannons)
  }
): Promise<string> {
  const { startDurationSecs, taskDurationSecs, campaignType, maximumAmountCkb } = opts;
  const maximumAmount = maximumAmountCkb * 100_000_000n; // CKB → shannons

  const tx = ccc.Transaction.default();
  tx.addCellDeps(FREIGHT_CELL_DEP);

  // Include the tip header as a header dep so the script can read the timestamp.
  const tipHeader = await signer.client.getTipHeader();
  tx.headerDeps.push(tipHeader.hash);

  // Creator lock = signer's recommended address lock.
  const addrObj = await signer.getRecommendedAddressObj();
  const lockArgBytes = hexToBytes(addrObj.script.args);
  const createdBy = new Uint8Array(20);
  createdBy.set(lockArgBytes.slice(0, 20));

  // Type script args: [0x00][startDuration(8)][taskDuration(8)][campaignType(1)][maxAmount(8)]
  const typeArgs = encodeCreateCampaignArgs(
    startDurationSecs,
    taskDurationSecs,
    campaignType,
    maximumAmount
  );

  // Campaign cell data (102 bytes). createdAt comes from the tip block timestamp (ms).
  const campaignData = encodeCampaignData({
    createdAt: tipHeader.timestamp,
    startDurationSecs: startDurationSecs,
    taskDurationSecs: taskDurationSecs,
    createdBy,
    campaignType,
    maximumAmount,
    currentDeposits: 0n,
    status: CampaignStatus.Created,
    rewardCount: 0n,
    randomnessHash: new Uint8Array(32),
  });

  // Output: campaign cell.
  // lock  = creator's own lock (they can spend it later)
  // type  = freight contract with create_campaign args
  // data  = 102-byte campaign blob
  tx.addOutput(
    {
      lock: addrObj.script,
      type: freightScript(typeArgs),
    },
    bytesToHex(campaignData)
  );

  // Auto-select inputs + change output to cover outputs + fees.
  await tx.completeFeeBy(signer, 1000n);

  return signer.sendTransaction(tx);
}

// ─── Query all campaign cells from the CKB indexer ───────────────────────────

export interface CampaignCell {
  outPoint: { txHash: string; index: number };
  data: CampaignData;
  capacityShannons: bigint;
}

export async function fetchCampaigns(
  client: ccc.Client,
  limit = 20
): Promise<CampaignCell[]> {
  const results: CampaignCell[] = [];

  // Use prefix mode so we match all cells with this type script regardless of args length.
  // findCellsByType hardcodes "exact" which would never match our 26-byte args.
  let count = 0;
  for await (const cell of client.findCells(
    {
      script: {
        codeHash: FREIGHT_CONTRACT.codeHash,
        hashType: FREIGHT_CONTRACT.hashType,
        args: "0x",
      },
      scriptType: "type",
      scriptSearchMode: "prefix",
      withData: true,
    },
    "desc",
    limit
  )) {
    if (count++ >= limit) break;
    try {
      const rawData = hexToBytes(cell.outputData);
      // Campaign cells are exactly 102 bytes; participant cells are 65 bytes.
      if (rawData.length !== 102) continue;
      results.push({
        outPoint: {
          txHash: cell.outPoint.txHash,
          index: Number(cell.outPoint.index),
        },
        data: decodeCampaignData(rawData),
        capacityShannons: cell.cellOutput.capacity,
      });
    } catch {
      // Skip malformed cells.
    }
  }

  return results;
}
