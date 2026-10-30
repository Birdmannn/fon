import { getRecordStableId } from "./campaignIdentity";
import { getFbarEventsCollection, getUserProfilesCollection } from "./mongodb";

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const normalized = (value: unknown) => text(value).toLowerCase();
type Publication = {eventKey: string; address: string; metadata?: Record<string, unknown>};
type CreatorProfile = {address: string; username?: string};

/** Publication FBARS events have already verified the transaction and Pilot owner. */
export function campaignCreatorAddress(record: Record<string, unknown>, publications: readonly Publication[]) {
  const txHash = normalized(record.txHash);
  const campaignId = getRecordStableId(record);
  const publication = txHash && campaignId ? publications.find(event =>
    event.eventKey === `freight-create:${txHash}` && normalized(event.metadata?.campaignId) === campaignId) : undefined;
  return normalized(publication?.address) || text(record.creatorAddress);
}

export function withCampaignCreatorIdentity<T extends Record<string, unknown>>(record: T, publications: readonly Publication[], profiles: readonly CreatorProfile[]) {
  const creatorAddress = campaignCreatorAddress(record, publications);
  if (!creatorAddress) return record;
  const username = text(profiles.find(profile => normalized(profile.address) === creatorAddress.toLowerCase())?.username);
  const addressChanged = normalized(record.creatorAddress) !== creatorAddress.toLowerCase();
  const creatorHandle = username ? `${username.replace(/\.ckb$/i, "")}.ckb`
    : addressChanged ? `freight${creatorAddress.toLowerCase().replace(/^0x/, "").slice(-20)}.ckb` : record.creatorHandle;
  return { ...record, creatorAddress, creatorHandle };
}

/** Batch enrichment serves the same owner identity to feed and detail clients. */
export async function resolveCampaignCreatorIdentities<T extends Record<string, unknown>>(records: T[]) {
  if (!records.length) return records;
  const eventKeys = [...new Set(records.map(record => normalized(record.txHash)).filter(Boolean))].map(hash => `freight-create:${hash}`);
  const publications = eventKeys.length ? await (await getFbarEventsCollection()).find(
    {kind: "freight-create", eventKey: {$in: eventKeys}},
    {projection: {_id: 0, eventKey: 1, address: 1, metadata: 1}},
  ).toArray() as unknown as Publication[] : [];
  const addresses = [...new Set(records.map(record => campaignCreatorAddress(record, publications).toLowerCase()).filter(Boolean))];
  const profiles = addresses.length ? await (await getUserProfilesCollection()).find(
    {address: {$in: addresses}}, {projection: {_id: 0, address: 1, username: 1}},
  ).toArray() as unknown as CreatorProfile[] : [];
  return records.map(record => withCampaignCreatorIdentity(record, publications, profiles));
}
