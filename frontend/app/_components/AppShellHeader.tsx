"use client";

import { Copy, Fingerprint } from "lucide-react";
import Link from "next/link";
import { type MouseEventHandler, type ReactNode, type RefObject, useCallback, useId, useRef } from "react";

import { useFreightWallet } from "@/app/_components/OwlWalletProvider";
import FreightInfoModal from "@/app/_components/FreightInfoModal";
import { useInfoError } from "@/app/_components/InfoErrorProvider";
import { useWalletSeedNotice } from "@/app/_hooks/useUserProfile";
import { useLightModePrimaryColor } from "@/app/providers";
import {
  LIGHT_MODE_PRIMARY_COLOR_OPTIONS,
  type LightModePrimaryColor,
} from "@/lib/lightModePrimaryColor";

const INFO_DOUBLE_TAP_INTERVAL_MS = 300;

type WalletUsdParts = {
  whole: string;
  decimals: string;
};

type AppShellHeaderProps = {
  canEditLightModePrimaryColor?: boolean;
  className: string;
  currentLightModePrimaryColor?: LightModePrimaryColor | null;
  infoButtonAriaLabel: string;
  infoModalAriaLabel: string;
  infoModalBackdropAriaLabel: string;
  infoModalBackdropInteractive: boolean;
  infoModalBody: ReactNode;
  infoModalActions?: ReactNode;
  infoModalClosing: boolean;
  infoModalOpen: boolean;
  isConnected: boolean;
  isSavingLightModePrimaryColor?: boolean;
  onConnect: () => void;
  onContainerClick?: MouseEventHandler<HTMLDivElement>;
  onCopyWalletAddress: () => void;
  onDisconnect: () => void;
  onInfoButtonBlur: () => void;
  onInfoButtonClick: () => void;
  onInfoButtonTouch: () => void;
  onInfoButtonFocus: () => void;
  onInfoModalKeepOpen: () => void;
  onInfoModalRequestClose: () => void;
  onInfoModalScheduleClose: () => void;
  onInfoMouseEnter: () => void;
  onInfoMouseLeave: () => void;
  onInfoWrapClick?: MouseEventHandler<HTMLDivElement>;
  onSaveLightModePrimaryColor?: (value: LightModePrimaryColor) => Promise<unknown>;
  onWalletActionClick?: () => void;
  onRightActionsClick?: MouseEventHandler<HTMLDivElement>;
  onWalletMouseEnter: () => void;
  onWalletMouseLeave: () => void;
  rightActions?: ReactNode;
  replaceWalletAction?: ReactNode;
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
  walletActionOnly?: boolean;
};

export default function AppShellHeader({
  canEditLightModePrimaryColor = false,
  className,
  currentLightModePrimaryColor = null,
  infoButtonAriaLabel,
  infoModalAriaLabel,
  infoModalBackdropAriaLabel,
  infoModalBackdropInteractive,
  infoModalBody,
  infoModalActions,
  infoModalClosing,
  infoModalOpen,
  isConnected,
  isSavingLightModePrimaryColor = false,
  onConnect,
  onContainerClick,
  onCopyWalletAddress,
  onDisconnect,
  onInfoButtonBlur,
  onInfoButtonClick,
  onInfoButtonTouch,
  onInfoButtonFocus,
  onInfoModalKeepOpen,
  onInfoModalRequestClose,
  onInfoModalScheduleClose,
  onInfoMouseEnter,
  onInfoMouseLeave,
  onInfoWrapClick,
  onSaveLightModePrimaryColor,
  onWalletActionClick,
  onRightActionsClick,
  onWalletMouseEnter,
  onWalletMouseLeave,
  rightActions,
  replaceWalletAction,
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
  walletActionOnly = false,
}: AppShellHeaderProps) {
  const { walletSelection } = useFreightWallet();
  const showWalletSeedNotice = useWalletSeedNotice();
  useInfoError(walletCopyFeedback === "error" ? "Copy failed" : null);
  useInfoError(walletInfoError);
  const { lightModePrimaryColor, setLightModePrimaryColor } = useLightModePrimaryColor();
  const activeLightModePrimaryColor = currentLightModePrimaryColor ?? lightModePrimaryColor;

  const infoTouchHintId = useId();
  const infoPointerTypeRef = useRef<string | null>(null);
  const lastInfoTouchTapRef = useRef<number | null>(null);

  const handleInfoButtonClick: MouseEventHandler<HTMLButtonElement> = (event) => {
    if (infoPointerTypeRef.current === "touch" && event.detail !== 0) {
      event.stopPropagation();
      const now = performance.now();
      const lastTap = lastInfoTouchTapRef.current;
      if (lastTap === null || now - lastTap > INFO_DOUBLE_TAP_INTERVAL_MS) {
        lastInfoTouchTapRef.current = now;
        onInfoButtonTouch();
        return;
      }
    }

    lastInfoTouchTapRef.current = null;
    onInfoModalRequestClose();
    onInfoButtonClick();
  };

  const handleLightModePrimaryColorSelect = useCallback(async (nextColor: LightModePrimaryColor) => {
    const previousColor = activeLightModePrimaryColor;
    if (!canEditLightModePrimaryColor || !onSaveLightModePrimaryColor || nextColor === previousColor || isSavingLightModePrimaryColor) {
      return;
    }

    setLightModePrimaryColor(nextColor);

    try {
      await onSaveLightModePrimaryColor(nextColor);
    } catch {
      setLightModePrimaryColor(previousColor);
    }
  }, [activeLightModePrimaryColor, canEditLightModePrimaryColor, isSavingLightModePrimaryColor, onSaveLightModePrimaryColor, setLightModePrimaryColor]);

  return (
    <div className={className} onClick={onContainerClick}>
      <div className="header-info-wrap" onClick={onInfoWrapClick}>
        <div
          onPointerEnter={(event) => {
            infoPointerTypeRef.current = event.pointerType;
            if (event.pointerType === "mouse") onInfoMouseEnter();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") onInfoMouseLeave();
          }}
        >
          <button
            ref={walletInfoButtonRef}
            type="button"
            className="header-info-btn"
            aria-label={infoButtonAriaLabel}
            aria-describedby={infoTouchHintId}
            onPointerDown={(event) => {
              infoPointerTypeRef.current = event.pointerType;
            }}
            onPointerCancel={() => {
              lastInfoTouchTapRef.current = null;
            }}
            onClick={handleInfoButtonClick}
            onFocus={() => {
              if (infoPointerTypeRef.current !== "touch") onInfoButtonFocus();
            }}
            onBlur={() => {
              if (infoPointerTypeRef.current !== "touch") onInfoButtonBlur();
            }}
          >
            <span className="header-info-inner-ring" aria-hidden="true" />
            <span className="header-info-glyph" aria-hidden="true">i</span>
          </button>
        </div>
        <span id={infoTouchHintId} className="sr-only">
          On touch screens, tap for information or double-tap within 300 milliseconds to go home.
        </span>
      </div>

      <div className="header-right-actions" onClick={onRightActionsClick}>
        {rightActions}

        <div className={`wallet-action-slot ${shouldHideWalletAction ? "wallet-action-slot-hidden" : ""}`}>
          {replaceWalletAction ? replaceWalletAction : isConnected ? (
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
                  {!walletActionOnly ? (
                    <>
                      <div className="wallet-info-section">
                        <span className="wallet-info-label">
                          Address <span className="wallet-chain-indicator wallet-chain-indicator-inline">({walletChainLabel})</span>
                        </span>
                        <div className="wallet-info-address-row">
                          <span className="wallet-info-address">{walletAddressDisplay || "Loading…"}</span>
                          <button
                            type="button"
                            className="wallet-info-copy-btn"
                            onClick={() => void onCopyWalletAddress()}
                            data-tooltip={walletAddress}
                            aria-label="Copy wallet address"
                          >
                            <Copy size={14} strokeWidth={2} aria-hidden="true" />
                          </button>
                        </div>
                        {walletCopyFeedback === "copied" ? <span className="wallet-info-feedback">Copied</span> : null}
                      </div>
                      <div className="wallet-info-section">
                        <span className="wallet-info-label">Balance</span>
                        <div className="wallet-info-balance-row">
                          <span className={`wallet-info-value ${walletBalanceIncreasing ? "wallet-balance-increasing" : ""}`.trim()}>{walletBalanceText}</span>
                          <span className="wallet-info-balance-approx">≈</span>
                          <span className={`wallet-info-usd ${walletBalanceIncreasing ? "wallet-balance-increasing" : ""}`.trim()}>
                            <span className="wallet-info-usd-currency">$</span>
                            <span>{walletUsdParts?.whole ?? "--"}</span>
                            <span className="wallet-info-usd-decimals">{walletUsdParts ? walletUsdParts.decimals : "--"}</span>
                          </span>
                        </div>
                      </div>
                    </>
                  ) : null}
                  {canEditLightModePrimaryColor || walletActionHref ? (
                    <div className="wallet-info-footer-row">
                      {canEditLightModePrimaryColor ? (
                        <div className="wallet-info-palette-group" role="group" aria-label="Select light mode primary color">
                          {LIGHT_MODE_PRIMARY_COLOR_OPTIONS.map((option) => {
                            const isSelected = activeLightModePrimaryColor === option.value;

                            return (
                              <button
                                key={option.value}
                                type="button"
                                className={`wallet-info-palette ${isSelected ? "wallet-info-palette-active" : ""}`.trim()}
                                onClick={() => void handleLightModePrimaryColorSelect(option.value)}
                                aria-label={`Set light mode primary color to ${option.label.toLowerCase()}`}
                                aria-pressed={isSelected}
                                disabled={isSavingLightModePrimaryColor}
                              >
                                <span
                                  className={`wallet-info-palette-swatch ${option.value === "#f2f0e4" ? "wallet-info-palette-swatch-cream" : "wallet-info-palette-swatch-white"}`.trim()}
                                  aria-hidden="true"
                                />
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {walletActionHref ? (
                        <Link
                          href={walletActionHref}
                          className="wallet-info-introspect-btn"
                          onClick={onWalletActionClick}
                          aria-label={walletActionLabel ?? "Introspect"}
                          data-tooltip={walletActionLabel ?? "Introspect"}
                          scroll={false}
                        >
                          {walletActionIcon ?? <Fingerprint size={14} strokeWidth={2} aria-hidden="true" />}
                        </Link>
                      ) : null}
                    </div>
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
        open={walletSelection.open || infoModalOpen || showWalletSeedNotice}
        closing={walletSelection.open ? walletSelection.closing : showWalletSeedNotice ? false : infoModalClosing}
        ariaLabel={walletSelection.open ? "Connect Wallet" : showWalletSeedNotice ? "Awarding FBARS" : infoModalAriaLabel}
        body={walletSelection.open ? (
          <div className="create-info-constraints-copy">
            <h2 id="connect-wallet-section-title" className="create-review-section-label campaign-freight-options-heading">Connect Wallet:</h2>
          </div>
        ) : showWalletSeedNotice ? (
          <div className="create-info-constraints-copy" role="status" aria-live="polite">
            <p className="mt-3 create-review-section-label">Awarding FBARS...</p>
            <p className="create-info-constraint-item">Hold and sign the next transaction</p>
          </div>
        ) : infoModalBody}
        actions={walletSelection.open ? (
          <div className="campaign-freight-options-controls freight-wallet-options" aria-labelledby="connect-wallet-section-title">
            <button type="button" className="create-info-confirm-btn freight-wallet-pilot" disabled={walletSelection.closing} onClick={walletSelection.pilot}>Pilot</button>
            <button type="button" className="create-info-confirm-btn freight-wallet-joyid" disabled={walletSelection.closing} onClick={walletSelection.joyId}>JoyID</button>
            <button type="button" className="create-info-confirm-btn freight-wallet-connector" disabled={walletSelection.closing} onClick={walletSelection.connector}>Connector</button>
          </div>
        ) : showWalletSeedNotice ? null : infoModalActions}
        backdropAriaLabel={walletSelection.open ? "Close wallet selection" : showWalletSeedNotice ? "Awarding FBARS in progress" : infoModalBackdropAriaLabel}
        backdropInteractive={walletSelection.open ? true : showWalletSeedNotice ? false : infoModalBackdropInteractive}
        onRequestClose={walletSelection.open ? walletSelection.close : showWalletSeedNotice ? () => undefined : onInfoModalRequestClose}
        onKeepOpen={walletSelection.open || showWalletSeedNotice ? () => undefined : onInfoModalKeepOpen}
        onScheduleClose={() => {
          if (!walletSelection.open && !showWalletSeedNotice && infoPointerTypeRef.current !== "touch") {
            onInfoModalScheduleClose();
          }
        }}
      />
    </div>
  );
}
