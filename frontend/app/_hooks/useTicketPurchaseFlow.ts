"use client";

import { getFreightProfileAddress } from "@/lib/profileIdentity";

import { useCallback, useRef, useState } from "react";

import { canAccessLockMountable, lockMountableAccessMessage } from "@/app/_lib/lockMountable";
import type { CampaignRecord } from "@/app/_hooks/useCampaignFeed";
import { CampaignStatus } from "@/lib/contract";
import { bytesToHex } from "@/lib/encoding";
import { getCampaignChainCreatedAt, getCampaignCreatedByHash, getCampaignStableId } from "@/lib/campaignIdentity";
import { assertFreightParentPreflight } from "@/lib/freightParentPreflight";
import { fetchCampaigns, fetchParticipants, getRaffleTicketsPerUser, sendUpdateCampaignStatus, sendVerifyParticipantRaffle, type CampaignCell } from "@/lib/transactions";
import { useFreightSigner } from "@/app/_components/OwlWalletProvider";

type UseTicketPurchaseFlowArgs = {
  currentViewerFbars?: number | null;
  onSubmissionError: (message: string) => void;
  onTicketBuySuccess: (txHash: string) => void;
};

export type TicketPurchaseAvailability = {
  liveSoldTickets: bigint;
  remainingTickets: bigint;
};

async function fetchCurrentFbars(address: string | null | undefined) {
  const normalizedAddress = address?.trim();
  if (!normalizedAddress) return null;
  const response = await fetch(`/api/user-profiles?address=${encodeURIComponent(normalizedAddress)}`, { cache: "no-store" });
  const payload = await response.json().catch(() => null) as { profile?: { fbars?: unknown } | null } | null;
  const fbars = payload?.profile?.fbars;
  return response.ok && typeof fbars === "number" && Number.isFinite(fbars) ? fbars : null;
}

export function useTicketPurchaseFlow({ currentViewerFbars, onSubmissionError, onTicketBuySuccess }: UseTicketPurchaseFlowArgs) {
  const signer = useFreightSigner();
  const [ticketPurchaseCampaign, setTicketPurchaseCampaign] = useState<CampaignCell | null>(null);
  const [ticketPurchaseRecord, setTicketPurchaseRecord] = useState<CampaignRecord | null>(null);
  const [ticketPurchaseAvailability, setTicketPurchaseAvailability] = useState<TicketPurchaseAvailability | null>(null);
  const ticketBoughtCallbackRef = useRef<((campaignId: string, ticketPrice: bigint, nextSoldTickets: bigint) => void) | null>(null);
  const [ticketPurchaseQuantity, setTicketPurchaseQuantity] = useState("1");
  const [ticketPurchaseError, setTicketPurchaseError] = useState("");
  const [isPurchasingTickets, setIsPurchasingTickets] = useState(false);

  const resetTicketPurchaseState = useCallback(() => {
    setTicketPurchaseCampaign(null);
    setTicketPurchaseRecord(null);
    setTicketPurchaseAvailability(null);
    ticketBoughtCallbackRef.current = null;
    setTicketPurchaseQuantity("1");
    setTicketPurchaseError("");
    setIsPurchasingTickets(false);
  }, []);

  const openTicketPurchaseInfoModal = useCallback((
    campaign: CampaignCell,
    record: CampaignRecord | null,
    availability: TicketPurchaseAvailability,
    onTicketBought: (campaignId: string, ticketPrice: bigint, nextSoldTickets: bigint) => void,
  ) => {
    setTicketPurchaseCampaign(campaign);
    setTicketPurchaseRecord(record);
    setTicketPurchaseAvailability(availability);
    ticketBoughtCallbackRef.current = onTicketBought;
    setTicketPurchaseQuantity("1");
    setTicketPurchaseError("");
    setIsPurchasingTickets(false);
  }, []);

  const handleTicketPurchaseSubmit = useCallback(async () => {
    if (!signer || !ticketPurchaseCampaign) {
      return;
    }

    setIsPurchasingTickets(true);
    setTicketPurchaseError("");
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

    try {
      await assertFreightParentPreflight(getCampaignStableId(ticketPurchaseCampaign), await signer.getRecommendedAddress());
    } catch (error) {
      setTicketPurchaseError(error instanceof Error ? error.message : "Could not check parent freight completion");
      setIsPurchasingTickets(false);
      return;
    }

    const [liveViewerFbars, creatorCurrentFbars] = await Promise.all([
      getFreightProfileAddress(signer).then((address) => fetchCurrentFbars(address)).catch(() => currentViewerFbars ?? null),
      fetchCurrentFbars(ticketPurchaseRecord?.creatorAddress).catch(() => null),
    ]);
    const effectiveViewerFbars = liveViewerFbars ?? currentViewerFbars;
    if (!canAccessLockMountable(ticketPurchaseRecord?.mountables?.lock, effectiveViewerFbars, creatorCurrentFbars)) {
      setTicketPurchaseError(lockMountableAccessMessage(ticketPurchaseRecord?.mountables?.lock, creatorCurrentFbars));
      setIsPurchasingTickets(false);
      return;
    }

    const quantity = Number(ticketPurchaseQuantity.trim());
    if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 100) {
      setTicketPurchaseError("Enter a valid number of tickets");
      setIsPurchasingTickets(false);
      return;
    }

    const requestedTickets = BigInt(quantity);

    const remainingTickets = ticketPurchaseAvailability?.remainingTickets ?? 0n;
    if (remainingTickets >= 0n && requestedTickets > remainingTickets) {
      setTicketPurchaseError(`Only ${String(remainingTickets)} tickets remain`);
      setIsPurchasingTickets(false);
      return;
    }

    try {
      const walletAddress = await signer.getRecommendedAddress();
      const priorEntries = await fetchParticipants(signer.client, ticketPurchaseCampaign, 5000, [walletAddress], true);
      const perUserLimit = getRaffleTicketsPerUser(ticketPurchaseCampaign);
      if (BigInt(priorEntries.length) + requestedTickets > perUserLimit) {
        setTicketPurchaseError(`This raffle allows ${String(perUserLimit)} ticket${perUserLimit === 1n ? "" : "s"} per wallet`);
        setIsPurchasingTickets(false);
        return;
      }
    } catch (error) {
      setTicketPurchaseError(error instanceof Error ? error.message : "Could not check existing tickets");
      setIsPurchasingTickets(false);
      return;
    }

    try {
      const needsActivation =
        ticketPurchaseCampaign.data.status !== CampaignStatus.Active &&
        !ticketPurchaseRecord?.activatedTxHash;

      let campaignForPurchase = ticketPurchaseCampaign;

      if (needsActivation) {
        setTicketPurchaseError("Step 1/2 — Activating raffle on-chain…");

        const activateTxHash = await sendUpdateCampaignStatus(signer, ticketPurchaseCampaign);

        if (ticketPurchaseRecord?._id) {
          const activatedByAddress = await signer.getRecommendedAddress();
          await fetch(`/api/campaign-records/${ticketPurchaseRecord._id}/activate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              activatedAt: new Date().toISOString(),
              activatedByAddress,
              activatedTxHash: activateTxHash,
            }),
          }).catch(() => {
            // Non-fatal — the on-chain state is the source of truth
          });
        }

        setTicketPurchaseError("Step 1/2 — Waiting for confirmation…");
        await new Promise((resolve) => setTimeout(resolve, 4000));

        const updatedCampaigns = await fetchCampaigns(signer.client);
        const updated = updatedCampaigns.find(
          (c) =>
            c.data.status === CampaignStatus.Active &&
            bytesToHex(c.data.createdBy) === bytesToHex(ticketPurchaseCampaign.data.createdBy) &&
            c.data.createdAt === ticketPurchaseCampaign.data.createdAt
        );

        if (!updated) {
          throw new Error("Activation confirmed but updated campaign cell not found yet. Please try again in a moment.");
        }

        campaignForPurchase = updated;
        setTicketPurchaseError("Step 2/2 — Buying ticket… Please hold…");
      }

      const txHash = await sendVerifyParticipantRaffle(signer, campaignForPurchase, requestedTickets);
      await fetch("/api/campaign-participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: getCampaignStableId(campaignForPurchase),
          createdByHash: getCampaignCreatedByHash(campaignForPurchase),
          chainCreatedAt: getCampaignChainCreatedAt(campaignForPurchase),
          campaignType: campaignForPurchase.data.campaignType,
          participantAddress: await signer.getRecommendedAddress(),
          participantKind: "raffle_ticket",
          participantTxHash: txHash,
          joinedAt: String(Date.now()),
          status: "verified",
        }),
      }).catch(() => {
        // Non-fatal — settlement can still fall back to on-chain discovery
      });
      const nextSoldTickets = (ticketPurchaseAvailability?.liveSoldTickets ?? 0n) + requestedTickets;
      ticketBoughtCallbackRef.current?.(getCampaignStableId(campaignForPurchase), campaignForPurchase.data.auxAmount, nextSoldTickets);
      setIsPurchasingTickets(false);
      onTicketBuySuccess(txHash);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to buy tickets";
      setTicketPurchaseError(message);
      setIsPurchasingTickets(false);
      onSubmissionError(message);
    }
  }, [currentViewerFbars, onSubmissionError, onTicketBuySuccess, signer, ticketPurchaseAvailability, ticketPurchaseCampaign, ticketPurchaseRecord, ticketPurchaseQuantity]);

  return {
    handleTicketPurchaseSubmit,
    isPurchasingTickets,
    openTicketPurchaseInfoModal,
    resetTicketPurchaseState,
    setIsPurchasingTickets,
    setTicketPurchaseError,
    setTicketPurchaseQuantity,
    ticketPurchaseCampaign,
    ticketPurchaseError,
    ticketPurchaseQuantity,
    ticketPurchaseRecord,
  };
}
