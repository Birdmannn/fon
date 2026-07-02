"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { useCallback, useEffect, useMemo, useState } from "react";

export type LinkedGoogleAccount = {
  sub: string;
  email: string;
  emailVerified: boolean;
  picture?: string | null;
  linkedAt?: string | null;
  lastRefreshedAt?: string | null;
};

type UserProfileWithGoogle = {
  googleAccount?: LinkedGoogleAccount | null;
};

export function useGoogleLink(signer: ccc.Signer | null, currentUserProfile: UserProfileWithGoogle | null) {
  const [isLinkingGoogle, setIsLinkingGoogle] = useState(false);
  const [isHydratingGoogleLink, setIsHydratingGoogleLink] = useState(false);
  const [googleLinkError, setGoogleLinkError] = useState("");
  const [linkedGoogleAccount, setLinkedGoogleAccount] = useState<LinkedGoogleAccount | null>(currentUserProfile?.googleAccount ?? null);

  useEffect(() => {
    setLinkedGoogleAccount(currentUserProfile?.googleAccount ?? null);
  }, [currentUserProfile?.googleAccount]);

  const beginGoogleLink = useCallback(async (redirectPath = typeof window !== "undefined" ? window.location.pathname : "/") => {
    if (!signer) {
      throw new Error("Connect a wallet first");
    }

    const address = await signer.getRecommendedAddress();
    if (!address) {
      throw new Error("Unable to resolve wallet address");
    }

    setIsLinkingGoogle(true);
    setGoogleLinkError("");

    try {
      const nonceResponse = await fetch("/api/google/link/nonce", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address }),
      });
      const noncePayload = await nonceResponse.json().catch(() => null);
      if (!nonceResponse.ok || typeof noncePayload?.nonce !== "string") {
        throw new Error(noncePayload?.error ?? "Failed to start Google link");
      }

      const signature = await signer.signMessage(noncePayload.nonce);
      const startResponse = await fetch("/api/google/link/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address,
          nonce: noncePayload.nonce,
          redirectPath,
          signature: {
            signature: signature.signature,
            identity: signature.identity,
            signType: signature.signType,
          },
        }),
      });
      const startPayload = await startResponse.json().catch(() => null);
      if (!startResponse.ok || typeof startPayload?.authUrl !== "string") {
        throw new Error(startPayload?.error ?? "Failed to start Google OAuth");
      }

      window.location.href = startPayload.authUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to link Google";
      setGoogleLinkError(message);
      throw error;
    } finally {
      setIsLinkingGoogle(false);
    }
  }, [signer]);

  const completeGoogleLinkFromUrl = useCallback(async () => {
    if (typeof window === "undefined") {
      return null;
    }

    const url = new URL(window.location.href);
    const code = url.searchParams.get("google_link_code")?.trim();
    if (!code || !signer) {
      return null;
    }

    const address = await signer.getRecommendedAddress();
    if (!address) {
      throw new Error("Unable to resolve wallet address");
    }

    setIsHydratingGoogleLink(true);
    setGoogleLinkError("");

    try {
      const response = await fetch("/api/google/link/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address, code }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.googleAccount) {
        throw new Error(payload?.error ?? "Failed to complete Google link");
      }

      setLinkedGoogleAccount(payload.googleAccount as LinkedGoogleAccount);
      url.searchParams.delete("google_link_code");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      return payload.googleAccount as LinkedGoogleAccount;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to complete Google link";
      setGoogleLinkError(message);
      throw error;
    } finally {
      setIsHydratingGoogleLink(false);
    }
  }, [signer]);

  useEffect(() => {
    if (!signer) {
      return;
    }

    void completeGoogleLinkFromUrl().catch(() => undefined);
  }, [completeGoogleLinkFromUrl, signer]);

  const isGoogleLinked = useMemo(() => Boolean(linkedGoogleAccount?.emailVerified && linkedGoogleAccount?.email), [linkedGoogleAccount]);

  return {
    beginGoogleLink,
    completeGoogleLinkFromUrl,
    googleLinkError,
    isGoogleLinked,
    isHydratingGoogleLink,
    isLinkingGoogle,
    linkedGoogleAccount,
    setLinkedGoogleAccount,
  };
}
