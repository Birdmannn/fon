export type FreightTreeRecord = {
  campaignId: string;
  parentCampaignId?: string | null;
  parentCampaignIds?: string[] | null;
};

export function parentIds(record: { parentCampaignId?: unknown; parentCampaignIds?: unknown } | null | undefined) {
  const values = [record?.parentCampaignId, ...(Array.isArray(record?.parentCampaignIds) ? record.parentCampaignIds : [])];
  return [...new Set(values.filter((value): value is string => typeof value === "string")
    .map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

export function countDirectChildren(campaignId: string, nodes: Array<Pick<FreightTreeRecord, "parentCampaignId" | "parentCampaignIds">>) {
  const normalizedId = campaignId.trim().toLowerCase();
  return nodes.filter((node) => parentIds(node).includes(normalizedId)).length;
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
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ancestors: string[] = [];
  const visit = (id: string, depth: number) => {
    if (depth > limit) throw new Error("Freight graph exceeds the supported depth");
    if (visiting.has(id)) throw new Error("Freight graph contains a cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parentId of parentIds(getRecord(id))) {
      if (!visited.has(parentId)) ancestors.push(parentId);
      visit(parentId, depth + 1);
    }
    visiting.delete(id);
    visited.add(id);
  };
  visit(campaignId.trim().toLowerCase(), 0);
  return ancestors;
}

export function wouldCreateCycle(childId: string, parentId: string, getRecord: (id: string) => FreightTreeRecord | null) {
  return childId.toLowerCase() === parentId.toLowerCase() || ancestorIds(parentId, getRecord).includes(childId.toLowerCase());
}

export function sharesDirectChild(leftId: string, rightId: string, nodes: FreightTreeRecord[]) {
  const left = leftId.toLowerCase();
  const right = rightId.toLowerCase();
  return nodes.some((node) => {
    const parents = parentIds(node);
    return parents.includes(left) && parents.includes(right);
  });
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
