import { ccc } from "@ckb-ccc/core";
import { PILOT_LEGACY_PASSKEY_CODE_HASH, PILOT_PASSKEY_CODE_HASH,
  PILOT_WALLET_GENERAL_CODE_HASH, PILOT_WALLET_SESSION_CODE_HASH } from "@owl/pilot";
import { getPublicCkbClient } from "./ckbClient";
import { getCampaignDepositsCollection, getCampaignParticipantsCollection, getFbarEventsCollection, getMongoCollection } from "./mongodb";

const normalize = (value: string) => value.trim().toLowerCase();
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const accountCodes = [PILOT_WALLET_GENERAL_CODE_HASH, PILOT_WALLET_SESSION_CODE_HASH];
const isPilotOwnerScript = (script: ccc.Script) =>
  [PILOT_PASSKEY_CODE_HASH, PILOT_LEGACY_PASSKEY_CODE_HASH].includes(script.codeHash)
    && script.hashType === "data2" && ccc.bytesFrom(script.args).length === 97;

/** Script commitments, rather than editable profile labels, establish account ownership. */
export function isProfileHistoryScript(owner: ccc.Script, candidate: ccc.Script) {
  if (owner.eq(candidate)) return true;
  return isPilotOwnerScript(owner) && accountCodes.includes(candidate.codeHash) && candidate.hashType === "data2"
    && ccc.bytesFrom(candidate.args).length === 104 && candidate.args.slice(0, 66) === owner.hash();
}

export async function profileHistoryAddressScope(address: string, client: ccc.Client) {
  const owner = (await ccc.Address.fromString(address, client)).script;
  const isPilotOwner = isPilotOwnerScript(owner);
  const normalized = normalize(address);
  if (!isPilotOwner) return { owner, lookup: new RegExp(`^${escapeRegex(normalized)}$`, "i"), isPilotOwner };

  // Encode both extremes after the owner commitment to find a safe bech32
  // prefix. Database prefix matches only discover candidates; full scripts are
  // checked below, including the entire owner hash and argument length.
  const prefixes = accountCodes.map(codeHash => {
    const encode = (byte: string) => ccc.Address.fromScript({ codeHash, hashType: "data2",
      args: `${owner.hash()}${byte.repeat(72)}` }, client).toString();
    const low = encode("00"), high = encode("ff");
    let length = 0;
    while (length < low.length && low[length] === high[length]) length++;
    return `^${escapeRegex(low.slice(0, length))}`;
  });
  return { owner, isPilotOwner, lookup: new RegExp(`(?:^${escapeRegex(normalized)}$|${prefixes.join("|")})`, "i") };
}

async function storedHistoryAddresses(lookup: RegExp) {
  const [records, participants, deposits, events] = await Promise.all([
    getMongoCollection(), getCampaignParticipantsCollection(), getCampaignDepositsCollection(), getFbarEventsCollection(),
  ]);
  const sources = [
    ...["creatorAddress", "activatedByAddress", "settledByAddress", "withdrawnByAddress", "settledRecipients.address",
      "socialMetadata.comments.creatorAddress"].map(field => ({collection: records, field})),
    {collection: participants, field: "participantAddress"}, {collection: deposits, field: "depositorAddress"},
    {collection: events, field: "address"},
  ];
  return (await Promise.all(sources.map(({collection, field}) => collection.distinct(field, {[field]: {$regex: lookup}})))).flat();
}

/** Discover historical sessions too; no current connection or migration is required. */
export async function profileHistoryAddresses(address: string, client = getPublicCkbClient(),
  loadCandidates: (lookup: RegExp) => Promise<unknown[]> = storedHistoryAddresses) {
  const scope = await profileHistoryAddressScope(address, client);
  const addresses = new Set([normalize(address)]);
  if (!scope.isPilotOwner) return [...addresses];
  for (const value of await loadCandidates(scope.lookup)) {
    if (typeof value !== "string") continue;
    const candidate = normalize(value);
    try {
      const script = (await ccc.Address.fromString(candidate, client)).script;
      if (isProfileHistoryScript(scope.owner, script)) addresses.add(candidate);
    } catch { /* Malformed historical metadata cannot establish an alias. */ }
  }
  return [...addresses];
}

export function profileHistoryAddressRegex(addresses: readonly string[]) {
  return new RegExp(`^(?:${addresses.map(escapeRegex).join("|")})$`, "i");
}
