"use client";

import { useShowInfoError } from "@/app/_components/InfoErrorProvider";
import { ccc } from "@ckb-ccc/connector-react";
import { PilotWalletProvider, validatePilotPolicies, type PilotCellPolicy, type PilotWalletJournal } from "@owl/pilot";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { FREIGHT_PERMISSIONS, installPermissionHandler, type FreightPermission } from "@/lib/owlPermissions";
import { FreightPilotSigner, PilotPolicyReviewRequired } from "@/lib/pilotWallet";
import { freightActionPolicy, mergePilotPolicyCatalog } from "@/lib/pilotProtocol";

type WalletSelection = { open: boolean; closing: boolean; close: () => void; pilot: () => void; joyId: () => void };
const WalletContext = createContext<{ walletSelection: WalletSelection; open: () => void; disconnect: () => void; client: ccc.Client; signer?: ccc.Signer } | null>(null);
export function useFreightWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("Missing Owl wallet provider");
  return value;
}
export function useFreightSigner() { return useFreightWallet().signer; }

type HostedAccount = { provider: PilotWalletProvider; signer: FreightPilotSigner; address: string; policies: PilotCellPolicy[] };
export function OwlWalletProvider({ children }: { children: ReactNode }) {
  const wallet = ccc.useCcc();
  const { close: closeWallet } = wallet;
  const [hosted, setHosted] = useState<HostedAccount>();
  const showError = useShowInfoError();
  const [choosingWallet, setChoosingWallet] = useState(false);
  const [walletSelectionClosing, setWalletSelectionClosing] = useState(false);
  const selectionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [externalReview, setExternalReview] = useState(false);
  const [selection, setSelection] = useState<FreightPermission[]>([]);
  const externalApproved = useRef<FreightPermission[]>([]);
  const externalPending = useRef<{ permission: FreightPermission; resolve: () => void; reject: (error: Error) => void } | undefined>(undefined);
  const externalDialog = useRef<HTMLDialogElement>(null);
  const active = useRef(hosted);
  active.current = hosted;
  const external = useRef(wallet.signerInfo?.signer);
  external.current = wallet.signerInfo?.signer;
  const identities = useRef(new WeakMap<ccc.Signer, string>());
  const inFlight = useRef(false);
  const connecting = useRef<PilotWalletProvider | undefined>(undefined);
  const walletUrl = process.env.NEXT_PUBLIC_PILOT_WALLET_URL?.trim() || "https://owl-pilot.vercel.app";

  const reportWalletError = useCallback((cause: unknown) => {
    // Native wallet dialogs occupy the top layer. Hide their presentation so
    // FON's existing animated error modal is visible; keep Pilot connected.
    connecting.current?.hide(); active.current?.provider.hide();
    externalDialog.current?.close(); setExternalReview(false);
    closeWallet();
    showError(cause instanceof Error ? cause.message : String(cause));
  }, [showError, closeWallet]);

  const grant = useCallback(async (permission?: FreightPermission, cells?: PilotCellPolicy[]) => {
    if (connecting.current) { connecting.current.open(); throw new Error("Finish the current Pilot approval first."); }
    if (!walletUrl) throw new Error("The Pilot wallet URL is not configured for this site yet.");
    if (process.env.NEXT_PUBLIC_CKB_NETWORK?.trim().toLowerCase() === "mainnet") throw new Error("Pilot currently supports testnet.");
    const previous = active.current;
    // Offer every Freight action. Pilot displays the complete catalog and lets
    // the user choose at most 16 policies, including any transaction effects.
    const policies = mergePilotPolicyCatalog(
      permission ? [freightActionPolicy(permission)] : [],
      cells ?? previous?.policies.filter(p => p.direction !== "message") ?? [],
      FREIGHT_PERMISSIONS.map(([id]) => freightActionPolicy(id)),
    );
    const provider = new PilotWalletProvider({ url: walletUrl });
    if (provider.origin === location.origin) { provider.dispose(); throw new Error("Pilot must use a separate wallet origin."); }
    connecting.current = provider;
    try {
      const connection = await provider.connect({ name: "Freight on Nervos", policies, budget: ccc.fixedPointFrom(200).toString() });
      const journal = await provider.request("logs") as PilotWalletJournal;
      if (!journal.state || journal.stopped) throw new Error("Pilot did not return an active session grant.");
      validatePilotPolicies(journal.state.policies);
      const next = { provider, signer: new FreightPilotSigner(wallet.client, provider), address: connection.address, policies: journal.state.policies.map(policy => ({ ...policy })) };
      identities.current.set(next.signer, next.address);
      active.current = next; setHosted(next);
      previous?.provider.dispose();
      if (previous && connection.address !== previous.address) throw new Error("Pilot account changed. Retry the action with the selected account.");
      if (permission && !next.policies.some(p => p.direction === "message" && p.lockHash === freightActionPolicy(permission).lockHash)) {
        throw new Error("The requested action was not selected in Pilot.");
      }
      return next;
    } catch (cause) {
      if (active.current?.provider !== provider) provider.dispose();
      throw cause;
    } finally { connecting.current = undefined; }
  }, [wallet.client, walletUrl]);

  const open = useCallback(() => {
    if (connecting.current) { connecting.current.open(); return; }
    if (active.current) { active.current.provider.open(); return; }
    if (external.current) { setSelection([...externalApproved.current]); setExternalReview(true); return; }
    if (selectionTimer.current) clearTimeout(selectionTimer.current);
    selectionTimer.current = undefined;
    setWalletSelectionClosing(false); setChoosingWallet(true);
  }, []);

  const closeSelection = useCallback((after?: () => void) => {
    if (selectionTimer.current) return;
    setWalletSelectionClosing(true);
    selectionTimer.current = setTimeout(() => {
      selectionTimer.current = undefined;
      setChoosingWallet(false); setWalletSelectionClosing(false); after?.();
    }, 620);
  }, []);
  useEffect(() => {
    if (!choosingWallet) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") closeSelection(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [choosingWallet, closeSelection]);
  useEffect(() => {
    if (externalReview) externalDialog.current?.showModal(); else externalDialog.current?.close();
  }, [externalReview]);
  useEffect(() => {
    externalApproved.current = [];
    externalPending.current?.reject(new Error("External wallet changed."));
    externalPending.current = undefined;
  }, [wallet.signerInfo?.signer]);
  useEffect(() => () => {
    if (selectionTimer.current) clearTimeout(selectionTimer.current);
    connecting.current?.dispose(); active.current?.provider.dispose();
    externalPending.current?.reject(new Error("Wallet provider closed."));
  }, []);

  useEffect(() => installPermissionHandler(async (ownerSigner, permission, operation) => {
    if (inFlight.current || connecting.current) {
      const cause = new Error("Finish the current Pilot request first.");
      reportWalletError(cause); throw cause;
    }
    inFlight.current = true;
    try {
      const owner = active.current;
      if (owner) {
        if (identities.current.get(ownerSigner) !== owner.address) throw new Error("Wallet changed. Retry with the current account.");
        let next = owner;
        if (!owner.policies.some(p => p.direction === "message" && p.lockHash === freightActionPolicy(permission).lockHash)) next = await grant(permission);
        if (!await next.signer.isConnected()) throw new Error("Reconnect Pilot to continue.");
        try { return await operation(next.signer); }
        catch (cause) {
          if (!(cause instanceof PilotPolicyReviewRequired)) throw cause;
          next = await grant(permission, cause.policies);
          return await operation(next.signer);
        }
      }
      if (external.current !== ownerSigner || !await ownerSigner.isConnected()) throw new Error("Reconnect your wallet to continue.");
      if (!externalApproved.current.includes(permission)) {
        await new Promise<void>((resolve, reject) => {
          externalPending.current = { permission, resolve, reject };
          setSelection([...externalApproved.current]); setExternalReview(true);
        });
      }
      if (external.current !== ownerSigner) throw new Error("Wallet account changed.");
      return await operation(ownerSigner);
    } catch (cause) { reportWalletError(cause); throw cause; }
    finally { inFlight.current = false; }
  }), [grant, reportWalletError]);

  const disconnect = () => {
    if (inFlight.current || connecting.current) return;
    const owner = active.current;
    if (!owner) {
      try { void Promise.resolve(wallet.disconnect()).catch(reportWalletError); }
      catch (cause) { reportWalletError(cause); }
      return;
    }
    // The header action opens account/session controls first. Hiding or opening
    // Pilot does not settle, revoke, remove its iframe, or clear the signer.
    try { owner.provider.open(); }
    catch (cause) { reportWalletError(cause); }
  };
  const closeExternal = () => {
    externalPending.current?.reject(new Error("Signing permission selection cancelled."));
    externalPending.current = undefined; setExternalReview(false);
  };
  const signer = hosted?.signer ?? wallet.signerInfo?.signer;
  return <WalletContext.Provider value={{ open, disconnect, client: wallet.client, signer, walletSelection: {
    open: choosingWallet, closing: walletSelectionClosing, close: () => closeSelection(),
    joyId: () => closeSelection(() => { wallet.open(); }),
    pilot: () => closeSelection(() => {
      void grant().catch(reportWalletError);
    }),
  } }}>
    {children}
    <dialog ref={externalDialog} className="pilot-modal freight-owl-dialog" aria-label="External wallet permissions" onCancel={event => { event.preventDefault(); closeExternal(); }}>
      <h2>External wallet permissions</h2>
      <p>Select actions Freight may request. Your wallet approves each signature.</p>
      {FREIGHT_PERMISSIONS.map(([permission, name, description]) => <label key={permission} className="permission-choice">
        <input type="checkbox" checked={selection.includes(permission)} onChange={event => setSelection(previous => event.target.checked ? [...previous, permission] : previous.filter(item => item !== permission))} />
        <span><strong>{name}</strong><small>{description}</small></span>
      </label>)}
      <button type="button" onClick={() => {
        const request = externalPending.current;
        if (request && !selection.includes(request.permission)) {
          const cause = new Error("The requested signing action was not selected.");
          externalPending.current = undefined; request.reject(cause);
          reportWalletError(cause); return;
        }
        externalApproved.current = [...selection]; externalPending.current = undefined;
        setExternalReview(false); request?.resolve();
      }}>Save selected permissions</button>
      <button type="button" onClick={closeExternal}>Cancel</button>
    </dialog>
  </WalletContext.Provider>;
}
