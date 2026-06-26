"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FREIGHT_CONTRACT } from "@/lib/contract";

const PROJECT_GITHUB_URL = "https://github.com/Birdmannn/fon";
const PROJECT_X_URL = "";

const GITHUB_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 0C5.37 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.6.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.49 11.49 0 0 1 12 6.844c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.565 21.795 24 17.298 24 12c0-6.627-5.373-12-12-12Z" />
  </svg>
);

const X_ICON = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.847h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932 6.064-6.932Zm-1.291 19.494h2.039L6.486 3.24H4.298L17.61 20.647Z" />
  </svg>
);

const MODAL_TITLES = ["FreightOnNervos", "货运43"];
const TITLE_PHASE_DELAY_MS = 150;
const TITLE_HOLD_MS = 8000;

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
  const [titleIndex, setTitleIndex] = useState(0);
  const [visibleCount, setVisibleCount] = useState(0);
  const [direction, setDirection] = useState<"typing" | "deleting">("typing");

  if (!open && (titleIndex !== 0 || visibleCount !== 0 || direction !== "typing")) {
    setTitleIndex(0);
    setVisibleCount(0);
    setDirection("typing");
  }

  const activeTitle = MODAL_TITLES[titleIndex] ?? MODAL_TITLES[0];
  const activeCharacters = useMemo(() => Array.from(activeTitle), [activeTitle]);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (direction === "typing" && visibleCount < activeCharacters.length) {
      const timer = window.setTimeout(() => {
        setVisibleCount((current) => current + 1);
      }, TITLE_PHASE_DELAY_MS);
      return () => window.clearTimeout(timer);
    }

    if (direction === "typing" && visibleCount >= activeCharacters.length) {
      const timer = window.setTimeout(() => {
        setDirection("deleting");
      }, TITLE_HOLD_MS);
      return () => window.clearTimeout(timer);
    }

    if (direction === "deleting" && visibleCount > 0) {
      const timer = window.setTimeout(() => {
        setVisibleCount((current) => current - 1);
      }, TITLE_PHASE_DELAY_MS);
      return () => window.clearTimeout(timer);
    }

    if (direction === "deleting" && visibleCount === 0) {
      const timer = window.setTimeout(() => {
        setTitleIndex((current) => (current + 1) % MODAL_TITLES.length);
        setDirection("typing");
      }, TITLE_PHASE_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
  }, [activeCharacters.length, direction, open, visibleCount]);

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
        <div className="header-info-modal-header">
          <div className="header-info-modal-title-row">
            <h1 className="text-2xl sm:text-3xl font-bold header-info-modal-title-typed" aria-label={activeTitle}>
              {activeCharacters.map((character, index) => (
                <span
                  key={`${titleIndex}-${character}-${index}`}
                  className="header-info-modal-title-char"
                  aria-hidden="true"
                  style={{ opacity: index < visibleCount ? 1 : 0 }}
                >
                  {character}
                </span>
              ))}
            </h1>
            <div className="header-info-modal-project-links" aria-label="Project links">
              <a
                href={PROJECT_GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="header-info-modal-project-link"
                aria-label="Open FreightOnNervos GitHub repository"
              >
                {GITHUB_ICON}
              </a>
              {PROJECT_X_URL ? (
                <a
                  href={PROJECT_X_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="header-info-modal-project-link"
                  aria-label="Open FreightOnNervos X profile"
                >
                  {X_ICON}
                </a>
              ) : (
                <span
                  className="header-info-modal-project-link header-info-modal-project-link-disabled"
                  aria-label="FreightOnNervos X link coming soon"
                >
                  {X_ICON}
                </span>
              )}
            </div>
          </div>
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
        </div>
        <div className="header-info-modal-scroll-area">
          {body}
          {actions}
        </div>
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
