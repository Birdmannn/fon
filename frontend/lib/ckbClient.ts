import { ccc } from "@ckb-ccc/connector-react";

const rpcUrl = process.env.NEXT_PUBLIC_CKB_RPC_URL?.trim();
const network = process.env.NEXT_PUBLIC_CKB_NETWORK?.trim().toLowerCase();

export function getPublicCkbClient() {
  return network === "mainnet"
    ? new ccc.ClientPublicMainnet(rpcUrl ? { url: rpcUrl } : undefined)
    : new ccc.ClientPublicTestnet(rpcUrl ? { url: rpcUrl } : undefined);
}
