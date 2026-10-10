"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import FreightInfoModal from "@/app/_components/FreightInfoModal";

const InfoErrorContext = createContext<(message: string) => void>(() => undefined);
const InfoSuccessContext = createContext<(message: string) => void>(() => undefined);
const DISPLAY_MS = 3000;
const EXIT_MS = 620;

export function InfoErrorProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"error" | "success">("error");
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

  const show = useCallback((nextMessage: string, nextTone: "error" | "success") => {
    if (!nextMessage.trim()) return;
    if (displayTimer.current) clearTimeout(displayTimer.current);
    if (exitTimer.current) clearTimeout(exitTimer.current);
    setMessage(nextMessage);
    setTone(nextTone);
    setClosing(false);
    displayTimer.current = setTimeout(close, DISPLAY_MS);
  }, [close]);

  const showError = useCallback((nextMessage: string) => show(nextMessage, "error"), [show]);
  const showSuccess = useCallback((nextMessage: string) => show(nextMessage, "success"), [show]);

  useEffect(() => () => {
    if (displayTimer.current) clearTimeout(displayTimer.current);
    if (exitTimer.current) clearTimeout(exitTimer.current);
  }, []);

  return (
    <InfoErrorContext.Provider value={showError}>
      <InfoSuccessContext.Provider value={showSuccess}>
      {children}
      <div className="global-info-error-anchor"><FreightInfoModal
        open={Boolean(message)}
        closing={closing}
        ariaLabel={tone === "success" ? "Success information" : "Error information"}
        backdropAriaLabel={tone === "success" ? "Close success information" : "Close error information"}
        backdropInteractive
        body={(
          <div className="create-info-constraints-copy" role={tone === "success" ? "status" : "alert"}>
            <p className={`mt-3 font-semibold ${tone === "success" ? "text-green-600" : "text-red-500"}`}>{tone === "success" ? "Success:" : "Errors:"}</p>
            <p className={`create-info-constraint-item break-words ${tone === "success" ? "text-green-600" : "text-red-500"}`}><span>{message}</span></p>
          </div>
        )}
        onRequestClose={close}
        onKeepOpen={() => undefined}
        onScheduleClose={() => undefined}
      /></div>
      </InfoSuccessContext.Provider>
    </InfoErrorContext.Provider>
  );
}

export function useShowInfoError() {
  return useContext(InfoErrorContext);
}

export function useShowInfoSuccess() {
  return useContext(InfoSuccessContext);
}

export function useInfoError(message: string | null | undefined) {
  const show = useShowInfoError();
  useEffect(() => {
    if (message) show(message);
  }, [message, show]);
}
