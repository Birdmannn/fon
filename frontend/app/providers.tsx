"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { CampaignFeedProvider } from "@/app/_hooks/useCampaignFeed";
import { UserProfileProvider } from "@/app/_hooks/useUserProfile";
import type { LightModePrimaryColor } from "@/lib/lightModePrimaryColor";
import {
  applyLightModePrimaryColorToDocument,
  DEFAULT_LIGHT_MODE_PRIMARY_COLOR,
  normalizeLightModePrimaryColor,
  persistLightModePrimaryColor,
  readStoredLightModePrimaryColor,
} from "@/lib/lightModePrimaryColor";

const rpcUrl = process.env.NEXT_PUBLIC_CKB_RPC_URL?.trim();
const network = process.env.NEXT_PUBLIC_CKB_NETWORK?.trim().toLowerCase();

const defaultClient = network === "mainnet"
  ? new ccc.ClientPublicMainnet(rpcUrl ? { url: rpcUrl } : undefined)
  : new ccc.ClientPublicTestnet(rpcUrl ? { url: rpcUrl } : undefined);

type LightModePrimaryColorContextValue = {
  lightModePrimaryColor: LightModePrimaryColor;
  setLightModePrimaryColor: (value: LightModePrimaryColor) => void;
};

const LightModePrimaryColorContext = createContext<LightModePrimaryColorContextValue>({
  lightModePrimaryColor: DEFAULT_LIGHT_MODE_PRIMARY_COLOR,
  setLightModePrimaryColor: () => undefined,
});

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

function LightModePrimaryColorController({ children }: { children: React.ReactNode }) {
  const [lightModePrimaryColor, setLightModePrimaryColorState] = useState<LightModePrimaryColor>(() => readStoredLightModePrimaryColor());

  useEffect(() => {
    applyLightModePrimaryColorToDocument(lightModePrimaryColor);
  }, [lightModePrimaryColor]);

  const value = useMemo<LightModePrimaryColorContextValue>(() => ({
    lightModePrimaryColor,
    setLightModePrimaryColor: (nextColor) => {
      const normalized = normalizeLightModePrimaryColor(nextColor);
      setLightModePrimaryColorState(normalized);
      persistLightModePrimaryColor(normalized);
      applyLightModePrimaryColorToDocument(normalized);
    },
  }), [lightModePrimaryColor]);

  return (
    <LightModePrimaryColorContext.Provider value={value}>
      {children}
    </LightModePrimaryColorContext.Provider>
  );
}

export function useLightModePrimaryColor() {
  return useContext(LightModePrimaryColorContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ccc.Provider defaultClient={defaultClient}>
      <CampaignFeedProvider>
        <UserProfileProvider>
          <LightModePrimaryColorController>
            <BlinkController />
            {children}
          </LightModePrimaryColorController>
        </UserProfileProvider>
      </CampaignFeedProvider>
    </ccc.Provider>
  );
}
