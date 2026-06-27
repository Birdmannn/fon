"use client";

import { Copy, Fingerprint } from "lucide-react";
import { type MouseEventHandler, type ReactNode, type RefObject } from "react";

import FreightInfoModal from "@/app/_components/FreightInfoModal";

type WalletUsdParts = {
  whole: string;
  decimals: string;
};

type AppShellHeaderProps = {
  className: string;
  infoButtonAriaLabel: string;
  infoModalAriaLabel: string;
  infoModalBackdropAriaLabel: string;
  infoModalBackdropInteractive: boolean;
  infoModalBody: ReactNode;
  infoModalActions?: ReactNode;
  infoModalClosing: boolean;
  infoModalOpen: boolean;
  isConnected: boolean;
  onConnect: () => void;
  onContainerClick?: MouseEventHandler<HTMLDivElement>;
  onCopyWalletAddress: () => void;
  onDisconnect: () => void;
  onInfoButtonBlur: () => void;
  onInfoButtonClick: () => void;
  onInfoButtonFocus: () => void;
  onInfoModalKeepOpen: () => void;
  onInfoModalRequestClose: () => void;
  onInfoModalScheduleClose: () => void;
  onInfoMouseEnter: () => void;
  onInfoMouseLeave: () => void;
  onInfoWrapClick?: MouseEventHandler<HTMLDivElement>;
  onWalletActionClick?: () => void;
  onRightActionsClick?: MouseEventHandler<HTMLDivElement>;
  onWalletMouseEnter: () => void;
  onWalletMouseLeave: () => void;
  rightActions?: ReactNode;
  shouldHideWalletAction?: boolean;
  walletAddress: string;
  walletAddressDisplay: string;
  walletBalanceIncreasing: boolean;
  walletBalanceText: string;
  walletChainLabel: string;
  walletCopyFeedback: "idle" | "copied" | "error";
  walletInfoButtonRef?: RefObject<HTMLButtonElement | null>;
  walletInfoError: string;
  walletModalClosing: boolean;
  walletModalOpen: boolean;
  walletUsdParts: WalletUsdParts | null;
  walletActionHref?: string;
  walletActionIcon?: ReactNode;
  walletActionLabel?: string;
};

export default function AppShellHeader({
  className,
  infoButtonAriaLabel,
  infoModalAriaLabel,
  infoModalBackdropAriaLabel,
  infoModalBackdropInteractive,
  infoModalBody,
  infoModalActions,
  infoModalClosing,
  infoModalOpen,
  isConnected,
  onConnect,
  onContainerClick,
  onCopyWalletAddress,
  onDisconnect,
  onInfoButtonBlur,
  onInfoButtonClick,
  onInfoButtonFocus,
  onInfoModalKeepOpen,
  onInfoModalRequestClose,
  onInfoModalScheduleClose,
  onInfoMouseEnter,
  onInfoMouseLeave,
  onInfoWrapClick,
  onWalletActionClick,
  onRightActionsClick,
  onWalletMouseEnter,
  onWalletMouseLeave,
  rightActions,
  shouldHideWalletAction = false,
  walletAddress,
  walletAddressDisplay,
  walletBalanceIncreasing,
  walletBalanceText,
  walletChainLabel,
  walletCopyFeedback,
  walletInfoButtonRef,
  walletInfoError,
  walletModalClosing,
  walletModalOpen,
  walletUsdParts,
  walletActionHref,
  walletActionIcon,
  walletActionLabel,
}: AppShellHeaderProps) {
  return (
    <div className={className} onClick={onContainerClick}>
      <div className="header-info-wrap" onClick={onInfoWrapClick}>
        <div onMouseEnter={onInfoMouseEnter} onMouseLeave={onInfoMouseLeave}>
          <button
            ref={walletInfoButtonRef}
            type="button"
            className="header-info-btn"
            aria-label={infoButtonAriaLabel}
            onClick={onInfoButtonClick}
            onFocus={onInfoButtonFocus}
            onBlur={onInfoButtonBlur}
          >
            <span className="header-info-inner-ring" aria-hidden="true" />
            <span className="header-info-glyph" aria-hidden="true">i</span>
          </button>
        </div>
      </div>

      <div className="header-right-actions" onClick={onRightActionsClick}>
        {rightActions}

        <div className={`wallet-action-slot ${shouldHideWalletAction ? "wallet-action-slot-hidden" : ""}`}>
          {isConnected ? (
            <div
              className="wallet-info-wrap"
              onMouseEnter={onWalletMouseEnter}
              onMouseLeave={onWalletMouseLeave}
            >
              <button
                type="button"
                onClick={onDisconnect}
                className="px-4 py-2 rounded-full overflow-hidden font-semibold text-sm btn-wallet w-full sm:w-auto"
              >
                Disconnect
              </button>
              {walletModalOpen ? (
                <div
                  className={`wallet-info-modal ${walletModalClosing ? "wallet-info-modal-closing" : ""}`}
                  role="dialog"
                  aria-label="Wallet details"
                  onMouseEnter={onWalletMouseEnter}
                  onMouseLeave={onWalletMouseLeave}
                >
                  <div className="wallet-info-section">
                    <span className="wallet-info-label">Address</span>
                    <div className="wallet-info-address-row">
                      <span className="wallet-info-address">{walletAddressDisplay || "Loading…"}</span>
                      <button
                        type="button"
                        className="wallet-info-copy-btn"
                        onClick={() => void onCopyWalletAddress()}
                        title={walletAddress}
                        aria-label="Copy wallet address"
                      >
                        <Copy size={14} strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                    {walletCopyFeedback === "copied" ? <span className="wallet-info-feedback">Copied</span> : null}
                    {walletCopyFeedback === "error" ? <span className="wallet-info-feedback wallet-info-feedback-error">Copy failed</span> : null}
                  </div>
                  <div className="wallet-info-grid">
                    <div className="wallet-info-section">
                      <span className="wallet-info-label">Balance</span>
                      <span className={`wallet-info-usd ${walletBalanceIncreasing ? "wallet-balance-increasing" : ""}`.trim()}>
                        <span className="wallet-info-usd-currency">$</span>
                        <span>{walletUsdParts?.whole ?? "--"}</span>
                        <span className="wallet-info-usd-decimals">{walletUsdParts ? walletUsdParts.decimals : "--"}</span>
                      </span>
                      <span className="wallet-info-value">{walletBalanceText}</span>
                    </div>
                    <div className="wallet-info-section">
                      <span className="wallet-info-label">Chain</span>
                      <span className="wallet-info-value wallet-chain-indicator">{walletChainLabel}</span>
                    </div>
                  </div>
                  {walletInfoError ? <p className="wallet-info-error">{walletInfoError}</p> : null}
                  {walletActionHref ? (
                    <a
                      href={walletActionHref}
                      className="wallet-info-introspect-btn"
                      onClick={onWalletActionClick}
                    >
                      {walletActionIcon ?? <Fingerprint size={14} strokeWidth={2} aria-hidden="true" />}
                      <span>{walletActionLabel ?? "Introspect"}</span>
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={onConnect}
              className="px-4 py-2 rounded-full overflow-hidden font-semibold text-sm btn-wallet w-full sm:w-auto"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </div>

      <FreightInfoModal
        open={infoModalOpen}
        closing={infoModalClosing}
        ariaLabel={infoModalAriaLabel}
        body={infoModalBody}
        actions={infoModalActions}
        backdropAriaLabel={infoModalBackdropAriaLabel}
        backdropInteractive={infoModalBackdropInteractive}
        onRequestClose={onInfoModalRequestClose}
        onKeepOpen={onInfoModalKeepOpen}
        onScheduleClose={onInfoModalScheduleClose}
      />
    </div>
  );
}
