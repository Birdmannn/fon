export type FreightTreeRecord = {
  campaignId: string;
  parentCampaignId?: string | null;
};

export function countDirectChildren(campaignId: string, nodes: Array<Pick<FreightTreeRecord, "parentCampaignId">>) {
  const normalizedId = campaignId.trim().toLowerCase();
  return nodes.filter((node) => node.parentCampaignId?.trim().toLowerCase() === normalizedId).length;
}

export function canEncroach(actorFbars: number, creatorFbars: number) {
  return Number.isFinite(actorFbars) && Number.isFinite(creatorFbars)
    && actorFbars >= 0 && creatorFbars >= 0 && actorFbars >= creatorFbars * 10;
}

export function ancestorIds(
  campaignId: string,
  getRecord: (id: string) => FreightTreeRecord | null,
  limit = 64,
) {
  const visited = new Set([campaignId]);
  const ancestors: string[] = [];
  let current = campaignId;
  while (ancestors.length < limit) {
    const parentId = getRecord(current)?.parentCampaignId?.trim().toLowerCase();
    if (!parentId) return ancestors;
    if (visited.has(parentId)) throw new Error("Freight tree contains a cycle");
    visited.add(parentId);
    ancestors.push(parentId);
    current = parentId;
  }
  throw new Error("Freight tree exceeds the supported depth");
}

export function wouldCreateCycle(childId: string, parentId: string, getRecord: (id: string) => FreightTreeRecord | null) {
  return childId === parentId || ancestorIds(parentId, getRecord).includes(childId);
}

export function effectiveParticipantStatus(ownSatisfied: boolean, ancestorsSatisfied: boolean[]) {
  return ownSatisfied && ancestorsSatisfied.every(Boolean) ? "verified" : "pending";
}

export function hasParticipantCreatedLinkedFreight(
  participantAddress: string,
  linkedFreights: Array<{ creatorAddress?: unknown }>,
) {
  const address = participantAddress.trim().toLowerCase();
  return Boolean(address) && linkedFreights.some((freight) => (
    typeof freight.creatorAddress === "string" && freight.creatorAddress.trim().toLowerCase() === address
  ));
}
