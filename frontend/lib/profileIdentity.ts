import { ccc } from "@ckb-ccc/core";
import { PilotHostedSigner, pilotWalletLock } from "@owl/pilot";

/** Profile identity is stable across Pilot session accounts; spending identity is not. */
export async function getFreightProfileAddress(signer: ccc.Signer): Promise<string> {
  if (!(signer instanceof PilotHostedSigner)) return signer.getRecommendedAddress();
  const connection = signer.provider.account;
  if (!connection) throw new Error("Reconnect Pilot to load your profile.");
  const owner = ccc.Address.fromScript(connection.account.ownerLock, signer.client);
  const session = ccc.Address.fromScript(pilotWalletLock(connection.account), signer.client);
  if (owner.toString() !== connection.ownerAddress || session.toString() !== connection.address) {
    throw new Error("Pilot returned inconsistent owner or session addresses.");
  }
  return owner.toString();
}
