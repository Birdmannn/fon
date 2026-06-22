"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { copyText } from "@/lib/clipboard";
import { deriveChainLabel } from "@/lib/campaignDisplay";
import { ccc } from "@ckb-ccc/connector-react";

export function useWalletInfo(client: ccc.Client, signer: ccc.Signer | null, showWalletInfoModal: boolean) {
  const [walletAddress, setWalletAddress] = useState("");
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [walletInfoError, setWalletInfoError] = useState("");
  const [walletInfoLoading, setWalletInfoLoading] = useState(false);
  const [walletCopyFeedback, setWalletCopyFeedback] = useState<"idle" | "copied" | "error">("idle");

  const walletChainLabel = useMemo(() => deriveChainLabel(client), [client]);

  const handleCopyWalletAddress = useCallback(async () => {
    if (!walletAddress) {
      return;
    }

    try {
      await copyText(walletAddress);
      setWalletCopyFeedback("copied");
      window.setTimeout(() => setWalletCopyFeedback("idle"), 1200);
    } catch {
      setWalletCopyFeedback("error");
      window.setTimeout(() => setWalletCopyFeedback("idle"), 1200);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!signer) {
      setWalletAddress("");
      setWalletBalance(null);
      setWalletInfoError("");
      setWalletInfoLoading(false);
      return;
    }

    if (!showWalletInfoModal) {
      return;
    }

    let cancelled = false;
    setWalletInfoLoading(true);
    setWalletInfoError("");

    void (async () => {
      try {
        const [nextAddress, nextBalance] = await Promise.all([
          signer.getRecommendedAddress(),
          signer.getBalance(),
        ]);

        if (cancelled) {
          return;
        }

        setWalletAddress(nextAddress ?? "");
        setWalletBalance(nextBalance);
      } catch (error) {
        if (cancelled) {
          return;
        }

        setWalletInfoError(error instanceof Error ? error.message : "Unable to load wallet details");
      } finally {
        if (!cancelled) {
          setWalletInfoLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [showWalletInfoModal, signer]);

  return {
    handleCopyWalletAddress,
    walletAddress,
    walletBalance,
    walletChainLabel,
    walletCopyFeedback,
    walletInfoError,
    walletInfoLoading,
  };
}
