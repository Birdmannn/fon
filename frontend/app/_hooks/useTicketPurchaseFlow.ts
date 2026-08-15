"use client";

import { useCallback, useRef, useState } from "react";

import { canAccessLockMountable, getLockMountableBypassFbars } from "@/app/_lib/lockMountable";
import type { CampaignRecord } from "@/app/_hooks/useCampaignFeed";
import { CampaignStatus } from "@/lib/contract";
import { bytesToHex } from "@/lib/encoding";
import { getCampaignChainCreatedAt, getCampaignCreatedByHash, getCampaignStableId } from "@/lib/campaignIdentity";
import { fetchCampaigns, sendUpdateCampaignStatus, sendVerifyParticipantRaffle, type CampaignCell } from "@/lib/transactions";
import { ccc } from "@ckb-ccc/connector-react";

type UseTicketPurchaseFlowArgs = {
  currentViewerFbars?: number | null;
  onSubmissionError: (message: string) => void;
  onTicketBuySuccess: (txHash: string) => void;
};

export type TicketPurchaseAvailability = {
  liveSoldTickets: bigint;
  remainingTickets: bigint;
};

export function useTicketPurchaseFlow({ currentViewerFbars, onSubmissionError, onTicketBuySuccess }: UseTicketPurchaseFlowArgs) {
  const signer = ccc.useSigner();
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

    if (!canAccessLockMountable(ticketPurchaseRecord?.mountables?.lock, currentViewerFbars)) {
      const bypassFbars = getLockMountableBypassFbars(ticketPurchaseRecord?.mountables?.lock);
      setTicketPurchaseError(bypassFbars === null ? "This raffle is locked." : `Need ${bypassFbars} FBARS to bypass this lock`);
      return;
    }

    const quantity = Number.parseInt(ticketPurchaseQuantity.trim(), 10);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setTicketPurchaseError("Enter a valid number of tickets");
      return;
    }

    const requestedTickets = BigInt(quantity);
    if (requestedTickets !== 1n) {
      setTicketPurchaseError("One ticket at a time for now");
      return;
    }

    const totalCostShannons = ticketPurchaseCampaign.data.auxAmount;
    if (totalCostShannons <= 0n) {
      setTicketPurchaseError("Ticket price is unavailable for this raffle");
      return;
    }

    const remainingTickets = ticketPurchaseAvailability?.remainingTickets ?? 0n;
    if (remainingTickets <= 0n) {
      setTicketPurchaseError(`Only ${String(remainingTickets)} tickets remain`);
      return;
    }

    setIsPurchasingTickets(true);
    setTicketPurchaseError("");

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

      const txHash = await sendVerifyParticipantRaffle(signer, campaignForPurchase);
      await fetch("/api/campaign-participants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: getCampaignStableId(campaignForPurchase),
          createdByHash: getCampaignCreatedByHash(campaignForPurchase),
          chainCreatedAt: getCampaignChainCreatedAt(campaignForPurchase),
          campaignType: campaignForPurchase.data.campaignType,
          participantAddress: await signer.getRecommendedAddress(),
          participantTxHash: txHash,
          joinedAt: String(Date.now()),
          status: "verified",
        }),
      }).catch(() => {
        // Non-fatal — settlement can still fall back to on-chain discovery
      });
      const nextSoldTickets = (ticketPurchaseAvailability?.liveSoldTickets ?? 0n) + requestedTickets;
      ticketBoughtCallbackRef.current?.(getCampaignStableId(campaignForPurchase), campaignForPurchase.data.auxAmount, nextSoldTickets);
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
