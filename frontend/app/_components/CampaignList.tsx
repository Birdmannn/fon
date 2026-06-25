"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { useEffect, useRef, useState } from "react";

import type { CampaignRecord, MergedCampaign } from "@/app/_hooks/useCampaignFeed";
import { getCampaignStableId } from "@/lib/campaignIdentity";
import type { CampaignCell } from "@/lib/transactions";

import CampaignCard from "./CampaignCard";

type SettlementRecipient = {
  address: string;
  username: string;
  handle: string;
  amountLabel: string;
};

type SettlementModalData = {
  campaignTitle: string;
  randomnessHash: string;
  randomnessPreimage: string | null;
  evidenceItems: string[];
  recipients: SettlementRecipient[];
  distributionTxHash: string | null;
  errorMessage?: string | null;
};

type CampaignListProps = {
  campaigns: MergedCampaign[];
  client: ccc.Client;
  commentDiscardDecision: { cardId: string; discard: boolean } | null;
  error: string;
  loading: boolean;
  onCommentDiscardRequest: (cardId: string) => void;
  onScrolledToNewest: () => void;
  onSettlementInfoRequest: (data: SettlementModalData) => void;
  onSettlementCompleted: (campaignId: string, settlementTxHash: string, settledAt: string, soldTicketCount: string) => void;
  onStartDetailTransition: (href: string) => void;
  onTicketBought: (campaignId: string, ticketPrice: bigint) => void;
  onTicketPurchaseRequest: (campaign: CampaignCell, record: CampaignRecord | null, onTicketBought: (campaignId: string, ticketPrice: bigint) => void) => void;
  shouldScrollToNewest: boolean;
};

export default function CampaignList({
  campaigns,
  client,
  commentDiscardDecision,
  error,
  loading,
  onCommentDiscardRequest,
  onScrolledToNewest,
  onSettlementCompleted,
  onSettlementInfoRequest,
  onStartDetailTransition,
  onTicketBought,
  onTicketPurchaseRequest,
  shouldScrollToNewest,
}: CampaignListProps) {
  const signer = ccc.useSigner();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [currentWalletAddress, setCurrentWalletAddress] = useState<string | null>(null);
  const newestCampaignRef = useRef<HTMLDivElement | null>(null);

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
    return <p className="text-sm text-gray-400">Sorry, an error occurred while loading freights</p>;
  }

  if (campaigns.length === 0) {
    return <p className="text-sm text-gray-400">No freights found on testnet yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {campaigns.map(({ campaign, record, displayStatus }, index) => (
        <div key={getCampaignStableId(campaign)} ref={index === 0 ? newestCampaignRef : null}>
          <CampaignCard
            campaign={campaign}
            record={record}
            displayStatus={displayStatus}
            signer={signer ?? null}
            client={client}
            currentWalletAddress={currentWalletAddress}
            nowMs={nowMs}
            isHighlighted={index === 99 && !!signer}
            onCommentDiscardRequest={onCommentDiscardRequest}
            commentDiscardDecision={commentDiscardDecision}
            onOpenDetail={() => onStartDetailTransition(`/campaign/${getCampaignStableId(campaign)}`)}
            onTicketPurchaseRequest={onTicketPurchaseRequest}
            onTicketBought={onTicketBought}
            onSettlementCompleted={onSettlementCompleted}
            onSettlementInfoRequest={onSettlementInfoRequest}
          />
        </div>
      ))}
    </div>
  );
}
