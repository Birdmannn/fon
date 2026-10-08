"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import FreightInfoModal from "@/app/_components/FreightInfoModal";

const InfoErrorContext = createContext<(message: string) => void>(() => undefined);
const DISPLAY_MS = 3000;
const EXIT_MS = 620;

export function InfoErrorProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState("");
  const [closing, setClosing] = useState(false);
  const displayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    if (displayTimer.current) clearTimeout(displayTimer.current);
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setClosing(true);
    exitTimer.current = setTimeout(() => {
      setMessage("");
      setClosing(false);
      exitTimer.current = null;
    }, EXIT_MS);
  }, []);

  const show = useCallback((nextMessage: string) => {
    if (!nextMessage.trim()) return;
    if (displayTimer.current) clearTimeout(displayTimer.current);
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setMessage(nextMessage);
    setClosing(false);
    displayTimer.current = setTimeout(close, DISPLAY_MS);
  }, [close]);

  useEffect(() => () => {
    if (displayTimer.current) clearTimeout(displayTimer.current);
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, []);

  return (
    <InfoErrorContext.Provider value={show}>
      {children}
      <div className="global-info-error-anchor"><FreightInfoModal
        open={Boolean(message)}
        closing={closing}
        ariaLabel="Error information"
        backdropAriaLabel="Close error information"
        backdropInteractive
        body={(
          <div className="create-info-constraints-copy" role="alert">
            <p className="mt-3 text-red-500 font-semibold">Errors:</p>
            <p className="create-info-constraint-item text-red-500 break-words"><span>{message}</span></p>
          </div>
        )}
        onRequestClose={close}
        onKeepOpen={() => undefined}
        onScheduleClose={() => undefined}
      /></div>
    </InfoErrorContext.Provider>
  );
}

export function useShowInfoError() {
  return useContext(InfoErrorContext);
}

export function useInfoError(message: string | null | undefined) {
  const show = useShowInfoError();
  useEffect(() => {
    if (message) show(message);
  }, [message, show]);
}
