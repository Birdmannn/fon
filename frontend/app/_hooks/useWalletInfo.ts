"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { copyText } from "@/lib/clipboard";
import { deriveChainLabel } from "@/lib/campaignDisplay";
import { ccc } from "@ckb-ccc/connector-react";

function truncateWalletAddress(address: string) {
  if (address.length <= 22) {
    return address;
  }

  return `${address.slice(0, 10)}…${address.slice(-10)}`;
}

function formatUsdParts(valueCkbShannons: bigint, usdPerCkb: number) {
  const usdCents = Math.max(0, Math.floor((Number(valueCkbShannons) / 1e8) * usdPerCkb * 100));
  const whole = Math.floor(usdCents / 100).toLocaleString();
  const decimals = String(usdCents % 100).padStart(2, "0");
  return { whole, decimals };
}

const BALANCE_REFRESH_MS = 4000;
const BALANCE_INCREASE_ANIMATION_MS = 900;
const CKB_PRICE_REFRESH_MS = 60000;
let cachedCkbUsdPrice: number | null = null;
let cachedCkbUsdPriceFetchedAt = 0;

async function fetchCkbUsdPrice() {
  const response = await fetch("/api/ckb-price", { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? "Failed to load CKB price");
  }

  const nextPrice = typeof payload?.usd === "number" ? payload.usd : Number(payload?.usd);
  if (!Number.isFinite(nextPrice) || nextPrice <= 0) {
    throw new Error("Invalid CKB price returned");
  }

  cachedCkbUsdPrice = nextPrice;
  cachedCkbUsdPriceFetchedAt = Date.now();
  return nextPrice;
}

export function useWalletInfo(client: ccc.Client, signer: ccc.Signer | null, showWalletInfoModal: boolean) {
  const [walletAddress, setWalletAddress] = useState("");
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [walletInfoError, setWalletInfoError] = useState("");
  const [walletInfoLoading, setWalletInfoLoading] = useState(false);
  const [walletCopyFeedback, setWalletCopyFeedback] = useState<"idle" | "copied" | "error">("idle");
  const [walletBalanceIncreasing, setWalletBalanceIncreasing] = useState(false);
  const [walletUsdPerCkb, setWalletUsdPerCkb] = useState<number | null>(cachedCkbUsdPrice);
  const balanceAnimationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const walletChainLabel = useMemo(() => deriveChainLabel(client), [client]);
  const walletUsdParts = useMemo(
    () => (walletBalance !== null && walletUsdPerCkb !== null ? formatUsdParts(walletBalance, walletUsdPerCkb) : null),
    [walletBalance, walletUsdPerCkb]
  );

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
    return () => {
      if (balanceAnimationTimerRef.current) {
        clearTimeout(balanceAnimationTimerRef.current);
        balanceAnimationTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!signer) {
      setWalletAddress("");
      setWalletBalance(null);
      setWalletInfoError("");
      setWalletInfoLoading(false);
      setWalletBalanceIncreasing(false);
      if (balanceAnimationTimerRef.current) {
        clearTimeout(balanceAnimationTimerRef.current);
        balanceAnimationTimerRef.current = null;
      }
      return;
    }

    if (!showWalletInfoModal) {
      return;
    }

    let cancelled = false;

    const syncWalletInfo = async () => {
      setWalletInfoLoading(true);
      setWalletInfoError("");

      try {
        const shouldRefreshUsdPrice = !cachedCkbUsdPrice || (Date.now() - cachedCkbUsdPriceFetchedAt) >= CKB_PRICE_REFRESH_MS;
        const [nextAddress, nextBalance, nextUsdPrice] = await Promise.all([
          signer.getRecommendedAddress(),
          signer.getBalance(),
          shouldRefreshUsdPrice
            ? fetchCkbUsdPrice().catch(() => cachedCkbUsdPrice)
            : Promise.resolve(cachedCkbUsdPrice),
        ]);

        if (cancelled) {
          return;
        }

        setWalletAddress(nextAddress ?? "");
        if (typeof nextUsdPrice === "number" && Number.isFinite(nextUsdPrice) && nextUsdPrice > 0) {
          setWalletUsdPerCkb(nextUsdPrice);
        }
        setWalletBalance((previousBalance) => {
          if (previousBalance !== null && nextBalance > previousBalance) {
            setWalletBalanceIncreasing(true);
            if (balanceAnimationTimerRef.current) {
              clearTimeout(balanceAnimationTimerRef.current);
            }
            balanceAnimationTimerRef.current = setTimeout(() => {
              setWalletBalanceIncreasing(false);
              balanceAnimationTimerRef.current = null;
            }, BALANCE_INCREASE_ANIMATION_MS);
          }

          return nextBalance;
        });
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
    };

    void syncWalletInfo();
    const intervalId = window.setInterval(() => {
      void syncWalletInfo();
    }, BALANCE_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [showWalletInfoModal, signer]);

  return {
    handleCopyWalletAddress,
    walletAddress,
    walletAddressDisplay: truncateWalletAddress(walletAddress),
    walletBalance,
    walletBalanceIncreasing,
    walletChainLabel,
    walletCopyFeedback,
    walletInfoError,
    walletInfoLoading,
    walletUsdParts,
  };
}
