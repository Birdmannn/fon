"use client";

import { OwlWalletProvider } from "@/app/_components/OwlWalletProvider";
import { ccc } from "@ckb-ccc/connector-react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import { CampaignFeedProvider } from "@/app/_hooks/useCampaignFeed";
import { InfoErrorProvider, useShowInfoError } from "@/app/_components/InfoErrorProvider";
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

function JoyIdConnectionError({ error }: { error?: { message: string } }) {
  const { close } = ccc.useCcc();
  const showError = useShowInfoError();
  useEffect(() => {
    if (!error) return;
    close();
    showError(error.message);
  }, [error, close, showError]);
  return null;
}

function WalletProviders({ children }: { children: React.ReactNode }) {
  const [connectionError, setConnectionError] = useState<{ message: string }>();
  const joyIdOnly = useMemo(() => {
    const wrapped = new WeakSet<ccc.Signer>();
    return async (signerInfo: ccc.SignerInfo, wallet: ccc.Wallet) => {
      if (wallet.name !== "JoyID Passkey" || signerInfo.signer.type !== ccc.SignerType.CKB) return false;
      const signer = signerInfo.signer;
      if (!wrapped.has(signer)) {
        const connect = signer.connect.bind(signer);
        signer.connect = async () => {
          try {
            await connect();
            if (!await signer.isConnected()) throw new Error("JoyID could not confirm the wallet connection.");
          } catch (cause) {
            setConnectionError({ message: cause instanceof Error ? cause.message : String(cause) });
            throw cause;
          }
        };
        wrapped.add(signer);
      }
      return true;
    };
  }, []);
  return (
    <ccc.Provider defaultClient={defaultClient} signerFilter={joyIdOnly} name="Freight on Nervos">
      <JoyIdConnectionError error={connectionError} />
      <OwlWalletProvider>
        <CampaignFeedProvider>
          <UserProfileProvider>
            <LightModePrimaryColorController>
              <BlinkController />
              {children}
            </LightModePrimaryColorController>
          </UserProfileProvider>
        </CampaignFeedProvider>
      </OwlWalletProvider>
    </ccc.Provider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return <InfoErrorProvider><WalletProviders>{children}</WalletProviders></InfoErrorProvider>;
}
