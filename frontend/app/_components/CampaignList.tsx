"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import type { CampaignRecord, MergedCampaign } from "@/app/_hooks/useCampaignFeed";
import { useInfoError } from "@/app/_components/InfoErrorProvider";
import type { SettlementModalData } from "@/app/_types/settlement";
import type { CampaignSupportRequest } from "@/app/_types/campaignSupport";
import { getCampaignStableId } from "@/lib/campaignIdentity";
import type { CampaignCell } from "@/lib/transactions";

import CampaignCard from "./CampaignCard";

type CampaignListProps = {
  campaigns: MergedCampaign[];
  client: ccc.Client;
  currentViewerFbars?: number | null;
  commentDiscardDecision: { cardId: string; discard: boolean } | null;
  error: string;
  loading: boolean;
  onCommentDiscardRequest: (cardId: string) => void;
  onMountablesClick: (record: CampaignRecord) => void;
  onFreightOptionsClick: (campaignId: string) => void;
  onScrolledToNewest: () => void;
  onSettlementInfoRequest: (data: SettlementModalData) => void;
  onSupportRequest: (request: CampaignSupportRequest) => void;
  onSettlementCompleted: (
    campaignId: string,
    settlementTxHash: string,
    settledAt: string,
    soldTicketCount: string,
    settledParticipantCount?: string | null,
    settledRecipients?: CampaignRecord["settledRecipients"]
  ) => void;
  onWithdrawalCompleted: (
    campaignId: string,
    withdrawalTxHash: string,
    withdrawnAt: string,
    withdrawnByAddress: string,
    withdrawnAmountShannons: string,
  ) => void;
  onStartDetailTransition: (href: string) => void;
  onTicketBought: (campaignId: string, ticketPrice: bigint, nextSoldTickets: bigint) => void;
  onTicketPurchaseRequest: (campaign: CampaignCell, record: CampaignRecord | null, liveSoldTickets: bigint, remainingTickets: bigint, onTicketBought: (campaignId: string, ticketPrice: bigint, nextSoldTickets: bigint) => void) => void;
  shouldScrollToNewest: boolean;
};

export default function CampaignList({
  campaigns,
  client,
  currentViewerFbars,
  commentDiscardDecision,
  error,
  loading,
  onCommentDiscardRequest,
  onMountablesClick,
  onFreightOptionsClick,
  onScrolledToNewest,
  onSettlementCompleted,
  onSettlementInfoRequest,
  onSupportRequest,
  onStartDetailTransition,
  onWithdrawalCompleted,
  onTicketBought,
  onTicketPurchaseRequest,
  shouldScrollToNewest,
}: CampaignListProps) {
  const signer = ccc.useSigner();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [currentWalletAddress, setCurrentWalletAddress] = useState<string | null>(null);
  const newestCampaignRef = useRef<HTMLDivElement | null>(null);
  useInfoError(error);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!signer) {
        if (!cancelled) {
          setCurrentWalletAddress(null);
        }
        return;
      }

      try {
        const nextWalletAddress = await signer.getRecommendedAddress();
        if (!cancelled) {
          setCurrentWalletAddress(nextWalletAddress ?? null);
        }
      } catch {
        if (!cancelled) {
          setCurrentWalletAddress(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signer]);

  useEffect(() => {
    if (!shouldScrollToNewest) {
      return;
    }

    newestCampaignRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    onScrolledToNewest();
  }, [onScrolledToNewest, shouldScrollToNewest]);

  if (loading) {
    return null;
  }

  if (error) {
    return null;
  }

  if (campaigns.length === 0) {
    return <p className="text-sm text-gray-400">No freights found on testnet yet.</p>;
  }

  return (
    <div className="flex flex-col gap-[0.45rem]">
      {campaigns.map(({ campaign, record, displayStatus }, index) => (
        <div
          key={getCampaignStableId(campaign)}
          ref={index === 0 ? newestCampaignRef : null}
          className="campaign-card-entry"
          style={{ "--campaign-card-enter-delay": `${Math.min(index, 8) * 45}ms` } as CSSProperties}
        >
          <CampaignCard
            campaign={campaign}
            record={record}
            displayStatus={displayStatus}
            signer={signer ?? null}
            client={client}
            currentViewerFbars={currentViewerFbars}
            currentWalletAddress={currentWalletAddress}
            nowMs={nowMs}
            isHighlighted={index === 99 && !!signer}
            onCommentDiscardRequest={onCommentDiscardRequest}
            commentDiscardDecision={commentDiscardDecision}
            onOpenDetail={() => onStartDetailTransition(`/freight/${getCampaignStableId(campaign)}`)}
            onMountablesClick={onMountablesClick}
            onFreightOptionsClick={() => onFreightOptionsClick(getCampaignStableId(campaign))}
            onSupportRequest={onSupportRequest}
            onTicketPurchaseRequest={onTicketPurchaseRequest}
            onTicketBought={onTicketBought}
            onSettlementCompleted={onSettlementCompleted}
            onWithdrawalCompleted={onWithdrawalCompleted}
            onSettlementInfoRequest={onSettlementInfoRequest}
          />
        </div>
      ))}
    </div>
  );
}
