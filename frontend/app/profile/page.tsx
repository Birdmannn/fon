"use client";

import { Copy } from "lucide-react";
import { ccc } from "@ckb-ccc/connector-react";
import { useCallback, useRef, useState } from "react";

import AppShellHeader from "@/app/_components/AppShellHeader";
import { useInfoModalState } from "@/app/_hooks/useInfoModalState";
import { useUserProfile } from "@/app/_hooks/useUserProfile";
import { useWalletInfo } from "@/app/_hooks/useWalletInfo";
import { formatCkbAmount } from "@/lib/campaignDisplay";

const INFO_MODAL_ANIMATION_MS = 620;
const PROFILE_INFO_MOUNTABLES_HEADING = "Mountables:";
const PROFILE_INFO_MOUNTABLES_ITEMS = ["These are apps mounted on (or as) freights. Coming soon."];
const PROFILE_INFO_TYPES_HEADING = "Freight types:";
const PROFILE_INFO_TYPE_ITEMS = [
  "1. Simple Task — a basic freight for posting a task without pooled deposits.",
  "2. Funded Task — a task funded up front so rewards can be distributed from the pool.",
  "3. Crowdfunding — an open funding freight where supporters deposit toward a shared pool.",
  "4. Timed Challenge — a challenge with a defined start and end window.",
  "5. Raffle — a ticket-based freight where entrants buy tickets for a randomized outcome.",
];

export default function ProfilePage() {
  const { open, disconnect, client } = ccc.useCcc();
  const signer = ccc.useSigner();
  const headerInfoButtonRef = useRef<HTMLButtonElement>(null);
  const {
    handleCopyWalletAddress,
    walletAddress,
    walletAddressDisplay,
    walletBalance,
    walletBalanceIncreasing,
    walletChainLabel,
    walletCopyFeedback,
    walletInfoError,
    walletInfoLoading,
    walletUsdParts,
  } = useWalletInfo(client, signer ?? null, false, true);
  const {
    currentUserProfile,
    isUserProfileLoading,
    userProfileError,
  } = useUserProfile(signer ?? null);

  const [showWalletInfoModal, setShowWalletInfoModal] = useState(false);
  const [isWalletInfoClosing, setIsWalletInfoClosing] = useState(false);
  const walletInfoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const walletInfoHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWalletInfoCloseTimer = useCallback(() => {
    if (walletInfoCloseTimerRef.current) {
      clearTimeout(walletInfoCloseTimerRef.current);
      walletInfoCloseTimerRef.current = null;
    }
  }, []);

  const clearWalletInfoHideTimer = useCallback(() => {
    if (walletInfoHideTimerRef.current) {
      clearTimeout(walletInfoHideTimerRef.current);
      walletInfoHideTimerRef.current = null;
    }
  }, []);

  const keepWalletInfoModalOpen = useCallback(() => {
    clearWalletInfoCloseTimer();
    clearWalletInfoHideTimer();
    setIsWalletInfoClosing(false);
    setShowWalletInfoModal(true);
  }, [clearWalletInfoCloseTimer, clearWalletInfoHideTimer]);

  const closeWalletInfoModal = useCallback(() => {
    clearWalletInfoCloseTimer();
    if (!showWalletInfoModal || isWalletInfoClosing) {
      return;
    }

    setIsWalletInfoClosing(true);
    clearWalletInfoHideTimer();
    walletInfoHideTimerRef.current = setTimeout(() => {
      setShowWalletInfoModal(false);
      setIsWalletInfoClosing(false);
      walletInfoHideTimerRef.current = null;
    }, 220);
  }, [clearWalletInfoCloseTimer, clearWalletInfoHideTimer, isWalletInfoClosing, showWalletInfoModal]);

  const scheduleWalletInfoModalClose = useCallback(() => {
    clearWalletInfoCloseTimer();
    walletInfoCloseTimerRef.current = setTimeout(() => {
      closeWalletInfoModal();
    }, 250);
  }, [clearWalletInfoCloseTimer, closeWalletInfoModal]);

  const {
    closeInfoModal,
    infoModalInteraction,
    isInfoModalClosing,
    openInfoModalFromHover,
    scheduleCloseInfoModal,
    showInfoModal,
    toggleInfoModal,
    keepInfoModalOpen,
  } = useInfoModalState({
    animationMs: INFO_MODAL_ANIMATION_MS,
    onResetState: () => {},
  });

  const resetInfoModalState = useCallback(() => {
    // No modal-specific transient state to reset on the first profile pass.
  }, []);

  const infoModalBody = (
    <div className="create-info-constraints-copy">
      <p>{PROFILE_INFO_MOUNTABLES_HEADING}</p>
      {PROFILE_INFO_MOUNTABLES_ITEMS.map((item) => (
        <p key={item} className="create-info-constraint-item">
          <span>{item}</span>
        </p>
      ))}
      <p className="mt-3">{PROFILE_INFO_TYPES_HEADING}</p>
      {PROFILE_INFO_TYPE_ITEMS.map((item) => (
        <p key={item} className="create-info-constraint-item">
          <span>{item}</span>
        </p>
      ))}
    </div>
  );

  const handleLabel = !signer
    ? "Connect wallet to introspect"
    : isUserProfileLoading
      ? "Loading…"
      : currentUserProfile?.handle ?? "Loading…";
  const fullAddressLabel = walletAddress || (signer ? "Loading…" : "Connect wallet to view your address");
  const walletBalanceText = walletBalance !== null ? `${formatCkbAmount(walletBalance)} CKB` : walletInfoLoading ? "Loading…" : "--";
  const profileErrorMessage = userProfileError || walletInfoError;

  return (
    <main className="profile-page">
      <div className="campaign-shell-width profile-page-shell">
        <AppShellHeader
          className="campaign-shell-header campaign-shell-width fixed top-8 left-4 right-4 z-[70] mx-auto flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
          infoButtonAriaLabel="Open Freight information"
          infoModalAriaLabel="Freight information modal"
          infoModalBackdropAriaLabel="Close Freight information modal"
          infoModalBackdropInteractive={infoModalInteraction === "click"}
          infoModalBody={infoModalBody}
          infoModalClosing={isInfoModalClosing}
          infoModalOpen={showInfoModal}
          isConnected={Boolean(signer)}
          onConnect={open}
          onCopyWalletAddress={() => void handleCopyWalletAddress()}
          onDisconnect={disconnect}
          onInfoButtonBlur={() => scheduleCloseInfoModal(false, resetInfoModalState)}
          onInfoButtonClick={() => toggleInfoModal(false)}
          onInfoButtonFocus={() => openInfoModalFromHover(false)}
          onInfoModalKeepOpen={keepInfoModalOpen}
          onInfoModalRequestClose={() => closeInfoModal(resetInfoModalState)}
          onInfoModalScheduleClose={() => scheduleCloseInfoModal(false, resetInfoModalState)}
          onInfoMouseEnter={() => openInfoModalFromHover(false)}
          onInfoMouseLeave={() => scheduleCloseInfoModal(false, resetInfoModalState)}
          onInfoWrapClick={(event) => event.stopPropagation()}
          onIntrospectClick={closeWalletInfoModal}
          onRightActionsClick={(event) => event.stopPropagation()}
          onWalletMouseEnter={keepWalletInfoModalOpen}
          onWalletMouseLeave={scheduleWalletInfoModalClose}
          walletAddress={walletAddress}
          walletAddressDisplay={walletAddressDisplay}
          walletBalanceIncreasing={walletBalanceIncreasing}
          walletBalanceText={walletBalanceText}
          walletChainLabel={walletChainLabel}
          walletCopyFeedback={walletCopyFeedback}
          walletInfoButtonRef={headerInfoButtonRef}
          walletInfoError={walletInfoError}
          walletModalClosing={isWalletInfoClosing}
          walletModalOpen={showWalletInfoModal}
          walletUsdParts={walletUsdParts}
          introspectHref="/profile"
        />

        <section className="profile-summary-card">
          <div className="profile-avatar-placeholder" aria-hidden="true">
            <span>Profile photo</span>
          </div>

          <div className="profile-summary-copy">
            <p className="profile-handle">{handleLabel}</p>

            <div className="profile-address-block">
              <div className="profile-address-row">
                <span className="profile-address-value">{fullAddressLabel}</span>
                {signer && walletAddress ? (
                  <button
                    type="button"
                    className="wallet-info-copy-btn profile-address-copy-btn"
                    onClick={() => void handleCopyWalletAddress()}
                    title={walletAddress}
                    aria-label="Copy full wallet address"
                  >
                    <Copy size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {walletCopyFeedback === "copied" ? <span className="wallet-info-feedback">Copied</span> : null}
              {walletCopyFeedback === "error" ? <span className="wallet-info-feedback wallet-info-feedback-error">Copy failed</span> : null}
            </div>

            <p className="profile-reputation-balance">0 FBARS</p>
            <p className="profile-reputation-caption">Reputation balance</p>

            <div className="profile-usd-balance" aria-live="polite">
              <span className="profile-usd-currency">$</span>
              <span>{walletUsdParts?.whole ?? "--"}</span>
              <span className="profile-usd-decimals">{walletUsdParts ? walletUsdParts.decimals : "--"}</span>
            </div>
            <p className="profile-usd-caption">Wallet USD balance</p>

            {walletBalanceText !== "--" ? <p className="profile-wallet-balance-note">{walletBalanceText}</p> : null}
            {profileErrorMessage ? <p className="wallet-info-error">{profileErrorMessage}</p> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
