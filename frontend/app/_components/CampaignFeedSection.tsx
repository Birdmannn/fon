"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import CampaignFeedHeaderBar from "@/app/_components/CampaignFeedHeaderBar";
import CampaignList from "@/app/_components/CampaignList";
import { useCampaignFeed, type CampaignRecord } from "@/app/_hooks/useCampaignFeed";
import type { SettlementModalData } from "@/app/_types/settlement";
import type { CampaignSupportRequest } from "@/app/_types/campaignSupport";
import type { CampaignCell } from "@/lib/transactions";

type CampaignFeedSectionProps = {
  client: ccc.Client;
  currentViewerFbars?: number | null;
  onCommentDiscardRequest: (cardId: string) => void;
  commentDiscardDecision: { cardId: string; discard: boolean } | null;
  onTicketPurchaseRequest: (campaign: CampaignCell, record: CampaignRecord | null, liveSoldTickets: bigint, remainingTickets: bigint, onTicketBought: (campaignId: string, ticketPrice: bigint, nextSoldTickets: bigint) => void) => void;
  onErrorChange: (message: string) => void;
  onMountablesClick: (record: CampaignRecord) => void;
  onFreightOptionsClick: (campaignId: string) => void;
  onSupportRequest: (request: CampaignSupportRequest) => void;
  onWithdrawalSuccess: (txHash: string) => void;
  onProfileDataChanged?: () => void;
  onSettlementInfoRequest: (data: SettlementModalData) => void;
};

export default function CampaignFeedSection({
  client,
  currentViewerFbars,
  onCommentDiscardRequest,
  commentDiscardDecision,
  onTicketPurchaseRequest,
  onErrorChange,
  onMountablesClick,
  onFreightOptionsClick,
  onSupportRequest,
  onWithdrawalSuccess,
  onProfileDataChanged,
  onSettlementInfoRequest,
}: CampaignFeedSectionProps) {
  const router = useRouter();
  const feedListRef = useRef<HTMLDivElement>(null);
  const pendingScrollFrameRef = useRef<number | null>(null);
  const {
    ensureLoaded,
    error,
    filteredCampaigns,
    handleRefresh,
    handleSearchClick,
    handleSettlementCompleted,
    handleShowPendingCampaigns,
    handleTicketBought,
    handleWithdrawalCompleted,
    isRefreshing,
    isSearchOpen,
    loading,
    searchInputRef,
    searchQuery,
    setSearchQuery,
    shouldScrollToNewest,
    clearShouldScrollToNewest,
    unseenCampaignBadgeLabel,
  } = useCampaignFeed();

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  useEffect(() => {
    if (!error) {
      return;
    }

    onErrorChange(error);
  }, [error, onErrorChange]);

  useEffect(() => () => {
    if (pendingScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingScrollFrameRef.current);
    }
  }, []);

  const handleShowPendingWithScroll = useCallback(() => {
    if (pendingScrollFrameRef.current !== null) return;

    const firstCard = feedListRef.current?.querySelector<HTMLElement>(".campaign-card-entry");
    if (!firstCard) {
      handleShowPendingCampaigns();
      return;
    }

    const scrollMargin = Number.parseFloat(window.getComputedStyle(firstCard).scrollMarginTop) || 0;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const targetTop = Math.min(maxScroll, Math.max(0, window.scrollY + firstCard.getBoundingClientRect().top - scrollMargin));
    if (Math.abs(window.scrollY - targetTop) <= 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      window.scrollTo({ top: targetTop, behavior: "auto" });
      handleShowPendingCampaigns();
      return;
    }

    const startedAt = window.performance.now();
    const checkScroll = () => {
      if (Math.abs(window.scrollY - targetTop) <= 2) {
        pendingScrollFrameRef.current = null;
        handleShowPendingCampaigns();
        return;
      }
      if (window.performance.now() - startedAt > 2000) {
        pendingScrollFrameRef.current = null;
        return;
      }
      pendingScrollFrameRef.current = window.requestAnimationFrame(checkScroll);
    };

    window.scrollTo({ top: targetTop, behavior: "smooth" });
    pendingScrollFrameRef.current = window.requestAnimationFrame(checkScroll);
  }, [handleShowPendingCampaigns]);

  return (
    <>
      <CampaignFeedHeaderBar
        isLoading={loading}
        isRefreshing={isRefreshing}
        isSearchOpen={isSearchOpen}
        onRefresh={handleRefresh}
        onSearchClick={handleSearchClick}
        onSearchQueryChange={setSearchQuery}
        onShowPendingCampaigns={handleShowPendingWithScroll}
        pendingBadgeLabel={unseenCampaignBadgeLabel}
        searchInputRef={searchInputRef}
        searchQuery={searchQuery}
      />

      <div ref={feedListRef} className="campaign-feed-content" style={{ overflowAnchor: "none" }}>
        <CampaignList
          campaigns={filteredCampaigns}
          client={client}
          currentViewerFbars={currentViewerFbars}
          loading={loading}
          error={error}
          shouldScrollToNewest={shouldScrollToNewest}
          onScrolledToNewest={clearShouldScrollToNewest}
          onCommentDiscardRequest={onCommentDiscardRequest}
          onMountablesClick={onMountablesClick}
          onFreightOptionsClick={onFreightOptionsClick}
          onSupportRequest={onSupportRequest}
          commentDiscardDecision={commentDiscardDecision}
          onStartDetailTransition={(href) => {
            sessionStorage.setItem("freight:detail-expanding", "1");
            router.push(href);
          }}
          onTicketPurchaseRequest={onTicketPurchaseRequest}
          onTicketBought={(campaignId, ticketPrice, nextSoldTickets) => {
            handleTicketBought(campaignId, ticketPrice, nextSoldTickets);
            onProfileDataChanged?.();
          }}
          onSettlementCompleted={(campaignId, settlementTxHash, settledAt, soldTicketCount, settledParticipantCount, settledRecipients) => {
            handleSettlementCompleted(campaignId, settlementTxHash, settledAt, soldTicketCount, settledParticipantCount, settledRecipients);
            onProfileDataChanged?.();
          }}
          onWithdrawalCompleted={(campaignId, withdrawalTxHash, withdrawnAt, withdrawnByAddress, withdrawnAmountShannons) => {
            handleWithdrawalCompleted(campaignId, withdrawalTxHash, withdrawnAt, withdrawnByAddress, withdrawnAmountShannons);
            onProfileDataChanged?.();
            onWithdrawalSuccess(withdrawalTxHash);
          }}
          onSettlementInfoRequest={onSettlementInfoRequest}
        />
      </div>
    </>
  );
}
