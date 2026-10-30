import { ccc } from "@ckb-ccc/core";
import { PILOT_WALLET_GENERAL_CODE_HASH, type PilotWalletProvider, type PilotWalletSelectedAccount } from "@owl/pilot";
import { FreightPilotSigner } from "./pilotWallet";
import { getFreightProfileAddress } from "./profileIdentity";
import { freightPilotCatalog } from "./pilotProtocol";
import { freightRecipientScripts, freightTransactionTemplates } from "./pilotTransactionTemplates";
export { FREIGHT_PILOT_BUDGET } from "./pilotTransactionTemplates";

/** Public selected context, with no signing authority before approval. */
export function selectedAccountSigner(client: ccc.Client, selected: PilotWalletSelectedAccount) {
  return new FreightPilotSigner(client, {
    account: selected, connected: false,
    request: async () => { throw new Error("Pilot policies must be built before signing authority is granted."); },
  } as unknown as PilotWalletProvider);
}

export async function buildFreightConnectionPolicies(client: ccc.Client, selected: PilotWalletSelectedAccount) {
  if (selected.account.deployment.codeHash !== PILOT_WALLET_GENERAL_CODE_HASH) {
    throw new Error("FON requires Pilot's general signing account. Update the Pilot wallet and reconnect.");
  }
  await getFreightProfileAddress(selectedAccountSigner(client, selected));
  return freightPilotCatalog(freightTransactionTemplates(await freightRecipientScripts(client)));
}
