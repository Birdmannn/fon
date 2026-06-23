import { bytesToHex, decodeSummary } from "@/lib/encoding";

type CampaignIdentityLike = {
  outPoint: { txHash: string };
  data: {
    createdBy: Uint8Array;
    createdAt: bigint | number | string;
    campaignType: number;
    summary: Uint8Array;
  };
};

type CampaignRecordIdentityLike = {
  campaignId?: string | null;
  createdByHash?: string | null;
  chainCreatedAt?: bigint | number | string | null;
  campaignType?: number | null;
  txHash?: string | null;
  summaryDraft?: string | null;
};

export type CampaignRecordIndexes<T> = {
  byCampaignId: Record<string, T>;
  byTxHash: Record<string, T>;
  byLegacyKey: Record<string, T>;
};

export function normalizeHash(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

export function normalizeSummary(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function buildStableCampaignId(
  createdByHash: string | null | undefined,
  chainCreatedAt: bigint | number | string | null | undefined,
  campaignType: number | string | null | undefined
) {
  const normalizedCreatedByHash = normalizeHash(createdByHash);
  const normalizedCreatedAt = chainCreatedAt === null || chainCreatedAt === undefined ? "" : String(chainCreatedAt).trim();
  const normalizedCampaignType = campaignType === null || campaignType === undefined ? "" : String(campaignType).trim();

  if (!normalizedCreatedByHash || !normalizedCreatedAt || !normalizedCampaignType) {
    return "";
  }

  return `${normalizedCreatedByHash}:${normalizedCreatedAt}:${normalizedCampaignType}`;
}

export function getCampaignCreatedByHash(campaign: CampaignIdentityLike) {
  return normalizeHash(bytesToHex(campaign.data.createdBy));
}

export function getCampaignChainCreatedAt(campaign: CampaignIdentityLike) {
  return String(campaign.data.createdAt);
}

export function getCampaignStableId(campaign: CampaignIdentityLike) {
  return buildStableCampaignId(
    getCampaignCreatedByHash(campaign),
    getCampaignChainCreatedAt(campaign),
    campaign.data.campaignType
  );
}

export function getRecordStableId(record: CampaignRecordIdentityLike) {
  const normalizedCampaignId = normalizeHash(record.campaignId);
  if (normalizedCampaignId) {
    return normalizedCampaignId;
  }

  return buildStableCampaignId(record.createdByHash, record.chainCreatedAt, record.campaignType);
}

export function buildLegacyCampaignRecordKey(
  campaignType: number | string | null | undefined,
  summary: string | null | undefined
) {
  const normalizedCampaignType = campaignType === null || campaignType === undefined ? "" : String(campaignType).trim();
  const normalizedSummary = normalizeSummary(summary);

  if (!normalizedCampaignType || !normalizedSummary) {
    return "";
  }

  return `${normalizedCampaignType}:${normalizedSummary}`;
}

export function getCampaignLegacyRecordKey(campaign: CampaignIdentityLike) {
  return buildLegacyCampaignRecordKey(campaign.data.campaignType, decodeSummary(campaign.data.summary));
}

export function getRecordLegacyRecordKey(record: CampaignRecordIdentityLike) {
  return buildLegacyCampaignRecordKey(record.campaignType, record.summaryDraft);
}

export function buildCampaignRecordIndexes<T extends CampaignRecordIdentityLike>(records: T[]): CampaignRecordIndexes<T> {
  const indexes: CampaignRecordIndexes<T> = {
    byCampaignId: {},
    byTxHash: {},
    byLegacyKey: {},
  };

  for (const record of records) {
    const campaignId = getRecordStableId(record);
    if (campaignId && !indexes.byCampaignId[campaignId]) {
      indexes.byCampaignId[campaignId] = record;
    }

    const txHash = normalizeHash(record.txHash);
    if (txHash && !indexes.byTxHash[txHash]) {
      indexes.byTxHash[txHash] = record;
    }

    const legacyKey = getRecordLegacyRecordKey(record);
    if (legacyKey && !indexes.byLegacyKey[legacyKey]) {
      indexes.byLegacyKey[legacyKey] = record;
    }
  }

  return indexes;
}

export function findCampaignRecord<T extends CampaignRecordIdentityLike>(
  indexes: CampaignRecordIndexes<T>,
  campaign: CampaignIdentityLike
): T | null {
  const campaignId = getCampaignStableId(campaign);
  if (campaignId && indexes.byCampaignId[campaignId]) {
    return indexes.byCampaignId[campaignId];
  }

  const txHash = normalizeHash(campaign.outPoint.txHash);
  if (txHash && indexes.byTxHash[txHash]) {
    return indexes.byTxHash[txHash];
  }

  const legacyKey = getCampaignLegacyRecordKey(campaign);
  if (legacyKey && indexes.byLegacyKey[legacyKey]) {
    return indexes.byLegacyKey[legacyKey];
  }

  return null;
}
