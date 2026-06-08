"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { useEffect } from "react";

const rpcUrl = process.env.NEXT_PUBLIC_CKB_RPC_URL?.trim();
const network = process.env.NEXT_PUBLIC_CKB_NETWORK?.trim().toLowerCase();

const defaultClient = network === "mainnet"
  ? new ccc.ClientPublicMainnet(rpcUrl ? { url: rpcUrl } : undefined)
  : new ccc.ClientPublicTestnet(rpcUrl ? { url: rpcUrl } : undefined);

// Drives a single shared blink cycle for all purple indicators.
// Toggles .blink-on on <body> every 500ms so all elements using it
// switch simultaneously — no per-element animation drift.
function BlinkController() {
  useEffect(() => {
    const tick = () => document.body.classList.toggle("blink-on");
    tick(); // start immediately in the on state
    const id = setInterval(tick, 500);
    return () => {
      clearInterval(id);
      document.body.classList.remove("blink-on");
    };
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ccc.Provider defaultClient={defaultClient}>
      <BlinkController />
      {children}
    </ccc.Provider>
  );
}
