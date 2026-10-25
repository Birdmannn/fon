export type PendingFreightPublication = {
  draftRecordId: string;
  summaryDraft: string;
  txHash: string;
  campaignId: string;
  createdByHash: string;
  chainCreatedAt: string;
  randomnessPreimage: string | null;
};

type PublicationRecord = {
  _id?: string;
  status?: string;
  txHash?: string | null;
  campaignId?: string | null;
  createdByHash?: string | null;
  chainCreatedAt?: string | null;
  summaryDraft?: string;
  randomnessPreimage?: string | null;
};

export function isPublishedFreight(record: PublicationRecord | null): boolean {
  return Boolean(record?._id && record.status === "published" && record.txHash);
}

/** A broadcast draft must resume finalization rather than create another transaction. */
export function pendingFreightPublication(record: PublicationRecord | null): PendingFreightPublication | null {
  if (!record?._id || record.status === "published" || !record.txHash
    || !record.campaignId || !record.createdByHash || !record.chainCreatedAt) return null;
  return {
    draftRecordId: record._id,
    summaryDraft: record.summaryDraft ?? "",
    txHash: record.txHash,
    campaignId: record.campaignId,
    createdByHash: record.createdByHash,
    chainCreatedAt: record.chainCreatedAt,
    randomnessPreimage: record.randomnessPreimage ?? null,
  };
}
