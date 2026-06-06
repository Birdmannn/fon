"use client";

import { ccc } from "@ckb-ccc/connector-react";

const rpcUrl = process.env.NEXT_PUBLIC_CKB_RPC_URL?.trim();
const network = process.env.NEXT_PUBLIC_CKB_NETWORK?.trim().toLowerCase();

const defaultClient = rpcUrl
  ? new ccc.ClientJsonRpc(rpcUrl)
  : network === "mainnet"
    ? new ccc.ClientPublicMainnet()
    : new ccc.ClientPublicTestnet();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ccc.Provider defaultClient={defaultClient}>
      {children}
    </ccc.Provider>
  );
}
