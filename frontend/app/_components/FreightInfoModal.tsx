"use client";

import type { ReactNode } from "react";
import { FREIGHT_CONTRACT } from "@/lib/contract";

type FreightInfoModalProps = {
  open: boolean;
  closing: boolean;
  ariaLabel: string;
  body: ReactNode;
  actions?: ReactNode;
  backdropAriaLabel: string;
  backdropInteractive: boolean;
  onRequestClose: () => void;
  onKeepOpen: () => void;
  onScheduleClose: () => void;
};

export default function FreightInfoModal({
  open,
  closing,
  ariaLabel,
  body,
  actions,
  backdropAriaLabel,
  backdropInteractive,
  onRequestClose,
  onKeepOpen,
  onScheduleClose,
}: FreightInfoModalProps) {
  if (!open) {
    return null;
  }

  return (
    <>
      <div
        className={`header-info-modal ${closing ? "header-info-modal-closing" : ""}`}
        role="dialog"
        aria-label={ariaLabel}
        onMouseEnter={onKeepOpen}
        onMouseLeave={onScheduleClose}
      >
        <h1 className="text-2xl sm:text-3xl font-bold">FreightOnNervos</h1>
        <p className="text-xs text-gray-400 font-mono break-all mt-2">
          Contract:{" "}
          <a
            href={`https://pudge.explorer.nervos.org/transaction/${FREIGHT_CONTRACT.outPoint.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {FREIGHT_CONTRACT.outPoint.txHash.slice(0, 22)}…
          </a>
        </p>
        {body}
        {actions}
      </div>

      <button
        type="button"
        className={`header-info-backdrop ${closing ? "header-info-backdrop-closing" : ""}`}
        aria-label={backdropAriaLabel}
        onClick={onRequestClose}
        style={{ pointerEvents: backdropInteractive ? "auto" : "none" }}
      />

    </>
  );
}
