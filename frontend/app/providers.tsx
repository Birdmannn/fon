"use client";

import { OwlWalletProvider } from "@/app/_components/OwlWalletProvider";
import { ccc } from "@ckb-ccc/connector-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

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

// Keep JoyID available to CCC's connection bookkeeping for the direct button,
// but remove it from the chooser's displayed wallets.
function ConnectorPresentation({ error }: { error?: { message: string } }) {
  const { isOpen, close } = ccc.useCcc();
  const showError = useShowInfoError();
  useEffect(() => {
    if (!error) return;
    close();
    showError(error.message);
  }, [error, close, showError]);
  useEffect(() => {
    if (!isOpen) return;
    const connector = document.querySelector<ccc.WebComponentConnector>("ccc-connector");
    if (!connector?.shadowRoot) return;
    let frame = 0;
    const resize = new ResizeObserver(() => connector.updated());
    const update = () => {
      const scene = connector.shadowRoot?.querySelector<HTMLElement & { wallets?: ccc.WalletWithSigners[] }>("ccc-selecting-scene");
      if (scene?.wallets?.some(wallet => wallet.name === "JoyID Passkey")) {
        scene.wallets = scene.wallets.filter(wallet => wallet.name !== "JoyID Passkey");
      }
      connector.shadowRoot?.querySelectorAll("ccc-selecting-scene, ccc-connected-scene").forEach(scene => resize.observe(scene));
      connector.updated();
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(connector.shadowRoot, { childList: true, subtree: true });
    connector.addEventListener("willUpdate", schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resize.disconnect();
      connector.removeEventListener("willUpdate", schedule);
    };
  }, [isOpen]);
  return null;
}

function WalletProviders({ children }: { children: React.ReactNode }) {
  const joyId = useRef<{ wallet: ccc.Wallet; signerInfo: ccc.SignerInfo } | undefined>(undefined);
  const [connectionError, setConnectionError] = useState<{ message: string }>();
  const wrapped = useRef(new WeakSet<ccc.Signer>());
  const signerFilter = useMemo(() => {
    return async (signerInfo: ccc.SignerInfo, wallet: ccc.Wallet) => {
      if (wallet.name === "JoyID Passkey") {
        if (signerInfo.signer.type !== ccc.SignerType.CKB) return false;
        joyId.current = { wallet, signerInfo };
      } else if (!wrapped.current.has(signerInfo.signer)) {
        const connect = signerInfo.signer.connect.bind(signerInfo.signer);
        signerInfo.signer.connect = async () => {
          try { await connect(); }
          catch (cause) {
            setConnectionError({ message: cause instanceof Error ? cause.message : String(cause) });
            throw cause;
          }
        };
        wrapped.current.add(signerInfo.signer);
      }
      return true;
    };
  }, []);
  const connectJoyId = async () => {
    const choice = joyId.current;
    const connector = document.querySelector<ccc.WebComponentConnector>("ccc-connector");
    const scene = connector?.shadowRoot?.querySelector("ccc-selecting-scene");
    if (!choice || !scene) throw new Error("JoyID is not ready yet. Please try again.");
    // Start from the user's click, before the info modal's closing transition,
    // so browsers allow JoyID to open its authentication popup.
    await choice.signerInfo.signer.connect();
    if (!await choice.signerInfo.signer.isConnected()) throw new Error("JoyID could not confirm the wallet connection.");
    // Use CCC's normal connection event to retain its signer and saved wallet
    // selection without opening its second wallet chooser.
    scene.dispatchEvent(Object.assign(new Event("connected"), {
      walletName: choice.wallet.name,
      signerName: choice.signerInfo.name,
    }));
  };
  return (
    <ccc.Provider defaultClient={defaultClient} signerFilter={signerFilter} name="Freight on Nervos">
      <ConnectorPresentation error={connectionError} />
      <OwlWalletProvider connectJoyId={connectJoyId}>
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
