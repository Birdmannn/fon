import { ccc } from "@ckb-ccc/core";
import { MAX_ACTION_CATALOG, type PilotCellPolicy, type PilotWalletProvider, type PilotWalletSelectedAccount } from "@owl/pilot";
import { FreightPilotSigner } from "./pilotWallet";
import { getFreightProfileAddress } from "./profileIdentity";
import { freightTransactionPolicies } from "./pilotCellPolicies";
import { freightPilotCatalog, mergePilotPolicyCatalog } from "./pilotProtocol";
import { buildCreateCampaignTransaction, buildRaffleTicketTransaction, fetchCampaigns } from "./transactions";
import { CampaignType, CampaignStatus } from "./contract";
import { decodeSummary } from "./encoding";
import { getCampaignStableId } from "./campaignIdentity";

export const FREIGHT_PILOT_BUDGET = 1_000_000n * 100_000_000n;
export type FreightPilotPolicySource = (signer: FreightPilotSigner) => Promise<readonly PilotCellPolicy[]>;

/** Pure builders can read this selected account, but cannot sign or use wallet RPC. */
export function selectedAccountSigner(client: ccc.Client, selected: PilotWalletSelectedAccount) {
  return new FreightPilotSigner(client, {
    account: selected, connected: false,
    request: async () => { throw new Error("Pilot policies must be built before signing authority is granted."); },
  } as unknown as PilotWalletProvider);
}

export async function buildFreightConnectionPolicies(client: ccc.Client, selected: PilotWalletSelectedAccount, sources: readonly FreightPilotPolicySource[] = [], preferredCampaignId?: string) {
  const signer = selectedAccountSigner(client, selected);
  await getFreightProfileAddress(signer); // Validate the public owner/session pair.
  let catalog = freightPilotCatalog();
  const append = (policies: readonly PilotCellPolicy[]) => {
    const combined = mergePilotPolicyCatalog(catalog, policies);
    catalog = combined;
  };
  let hasDraftPolicies = false;
  for (const source of sources) {
    const policies = await source(signer);
    hasDraftPolicies ||= policies.length > 0;
    append(policies);
  }
  if (!hasDraftPolicies) {
    // The untouched composer defaults: other draft configurations register their own source.
    const { tx } = await buildCreateCampaignTransaction(signer, {
      campaignType: CampaignType.SimpleTask, startDurationSecs: 0n, taskDurationSecs: 0n,
      maximumAmountCkb: 1000n, auxAmountCkb: 0n, rewardCount: 1n, supportPoolBps: 0n,
      summary: "", randomnessHash: new Uint8Array(32),
    });
    append(await freightTransactionPolicies({ client, account: selected.account, permission: "create-campaign", transaction: tx, data: "any", maxCapacity: FREIGHT_PILOT_BUDGET }));
  }
  const campaigns = await fetchCampaigns(client, 100);
  campaigns.sort((a, b) => Number(getCampaignStableId(b) === preferredCampaignId) - Number(getCampaignStableId(a) === preferredCampaignId));
  for (const campaign of campaigns) {
    if ((campaign.data.campaignType !== CampaignType.Raffle && campaign.data.campaignType !== CampaignType.RecurringRaffle)
      || (campaign.data.status !== CampaignStatus.Created && campaign.data.status !== CampaignStatus.Active)) continue;
    // Two rules are needed together: raffle state and this account's entry cells.
    if (catalog.length + 2 > MAX_ACTION_CATALOG) break;
    // Approval-gated raffles cannot be entered until their approval is confirmed.
    if (campaign.data.approval?.stage === "on-commence" && !campaign.data.approval.confirmed) continue;
    const tx = await buildRaffleTicketTransaction(signer, campaign, 1n);
    const policies = await freightTransactionPolicies({ client, account: selected.account, permission: "buy-tickets", transaction: tx,
      data: "any", maxCapacity: campaign.capacityShannons + FREIGHT_PILOT_BUDGET });
    const title = decodeSummary(campaign.data.summary).trim().slice(0, 30) || campaign.data.createdAt.toString();
    policies[0].name = `Buy tickets — ${title}: raffle state`;
    policies[1].name = `Buy tickets — ${title}: ticket entries`;
    append(policies);
  }
  return catalog;
}
