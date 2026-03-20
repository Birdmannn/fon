"use client";

import { ccc } from "@ckb-ccc/connector-react";

const testnetClient = new ccc.ClientPublicTestnet();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ccc.Provider defaultClient={testnetClient}>
      {children}
    </ccc.Provider>
  );
}
