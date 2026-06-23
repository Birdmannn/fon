"use client";

import { useCallback, useRef, useState } from "react";

import type { CampaignRecord } from "@/app/_hooks/useCampaignFeed";
import { CampaignStatus } from "@/lib/contract";
import { bytesToHex } from "@/lib/encoding";
import { getCampaignStableId } from "@/lib/campaignIdentity";
import { fetchCampaigns, sendUpdateCampaignStatus, sendVerifyParticipantRaffle, type CampaignCell } from "@/lib/transactions";
import { ccc } from "@ckb-ccc/connector-react";

type UseTicketPurchaseFlowArgs = {
  onSubmissionError: (message: string) => void;
  onTicketBuySuccess: (txHash: string) => void;
};

export function useTicketPurchaseFlow({ onSubmissionError, onTicketBuySuccess }: UseTicketPurchaseFlowArgs) {
  const signer = ccc.useSigner();
  const [ticketPurchaseCampaign, setTicketPurchaseCampaign] = useState<CampaignCell | null>(null);
  const [ticketPurchaseRecord, setTicketPurchaseRecord] = useState<CampaignRecord | null>(null);
  const ticketBoughtCallbackRef = useRef<((campaignId: string, ticketPrice: bigint) => void) | null>(null);
  const [ticketPurchaseQuantity, setTicketPurchaseQuantity] = useState("1");
  const [ticketPurchaseError, setTicketPurchaseError] = useState("");
  const [isPurchasingTickets, setIsPurchasingTickets] = useState(false);

  const resetTicketPurchaseState = useCallback(() => {
    setTicketPurchaseCampaign(null);
    setTicketPurchaseRecord(null);
    ticketBoughtCallbackRef.current = null;
    setTicketPurchaseQuantity("1");
    setTicketPurchaseError("");
    setIsPurchasingTickets(false);
  }, []);

  const openTicketPurchaseInfoModal = useCallback((campaign: CampaignCell, record: CampaignRecord | null, onTicketBought: (campaignId: string, ticketPrice: bigint) => void) => {
    setTicketPurchaseCampaign(campaign);
    setTicketPurchaseRecord(record);
    ticketBoughtCallbackRef.current = onTicketBought;
    setTicketPurchaseQuantity("1");
    setTicketPurchaseError("");
    setIsPurchasingTickets(false);
  }, []);

  const handleTicketPurchaseSubmit = useCallback(async () => {
    if (!signer || !ticketPurchaseCampaign) {
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

    const remainingCapacity = ticketPurchaseCampaign.data.maximumAmount > ticketPurchaseCampaign.data.currentDeposits
      ? ticketPurchaseCampaign.data.maximumAmount - ticketPurchaseCampaign.data.currentDeposits
      : 0n;
    const remainingTickets = ticketPurchaseCampaign.data.auxAmount > 0n
      ? remainingCapacity / ticketPurchaseCampaign.data.auxAmount
      : 0n;
    if (remainingTickets <= 0n || totalCostShannons > remainingCapacity) {
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
          await fetch(`/api/campaign-records/${ticketPurchaseRecord._id}/activate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ activatedTxHash: activateTxHash }),
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
      ticketBoughtCallbackRef.current?.(getCampaignStableId(campaignForPurchase), campaignForPurchase.data.auxAmount);
      onTicketBuySuccess(txHash);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to buy tickets";
      setTicketPurchaseError(message);
      setIsPurchasingTickets(false);
      onSubmissionError(message);
    }
  }, [onSubmissionError, onTicketBuySuccess, signer, ticketPurchaseCampaign, ticketPurchaseRecord, ticketPurchaseQuantity]);

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
