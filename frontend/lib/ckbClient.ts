import { ClientPublicMainnet, ClientPublicTestnet } from "@ckb-ccc/core";

const rpcUrl = process.env.NEXT_PUBLIC_CKB_RPC_URL?.trim();
const network = process.env.NEXT_PUBLIC_CKB_NETWORK?.trim().toLowerCase();

export function getPublicCkbClient() {
  return network === "mainnet"
    ? new ClientPublicMainnet(rpcUrl ? { url: rpcUrl } : undefined)
    : new ClientPublicTestnet(rpcUrl ? { url: rpcUrl } : undefined);
}
