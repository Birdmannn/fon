"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import CampaignFeedHeaderBar from "@/app/_components/CampaignFeedHeaderBar";
import CampaignList from "@/app/_components/CampaignList";
import { useCampaignFeed, type CampaignRecord } from "@/app/_hooks/useCampaignFeed";
import type { SettlementModalData } from "@/app/_types/settlement";
import type { CampaignCell } from "@/lib/transactions";

type CampaignFeedSectionProps = {
  client: ccc.Client;
  currentViewerFbars?: number | null;
  onCommentDiscardRequest: (cardId: string) => void;
  commentDiscardDecision: { cardId: string; discard: boolean } | null;
  onTicketPurchaseRequest: (campaign: CampaignCell, record: CampaignRecord | null, liveSoldTickets: bigint, remainingTickets: bigint, onTicketBought: (campaignId: string, ticketPrice: bigint, nextSoldTickets: bigint) => void) => void;
  onErrorChange: (message: string) => void;
  onSettlementInfoRequest: (data: SettlementModalData) => void;
};

export default function CampaignFeedSection({
  client,
  currentViewerFbars,
  onCommentDiscardRequest,
  commentDiscardDecision,
  onTicketPurchaseRequest,
  onErrorChange,
  onSettlementInfoRequest,
}: CampaignFeedSectionProps) {
  const router = useRouter();
  const {
    ensureLoaded,
    error,
    filteredCampaigns,
    handleRefresh,
    handleSearchClick,
    handleSettlementCompleted,
    handleShowPendingCampaigns,
    handleTicketBought,
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

  return (
    <>
      <CampaignFeedHeaderBar
        isLoading={loading}
        isRefreshing={isRefreshing}
        isSearchOpen={isSearchOpen}
        onRefresh={handleRefresh}
        onSearchClick={handleSearchClick}
        onSearchQueryChange={setSearchQuery}
        onShowPendingCampaigns={handleShowPendingCampaigns}
        pendingBadgeLabel={unseenCampaignBadgeLabel}
        searchInputRef={searchInputRef}
        searchQuery={searchQuery}
      />

      <CampaignList
        campaigns={filteredCampaigns}
        client={client}
        currentViewerFbars={currentViewerFbars}
        loading={loading}
        error={error}
        shouldScrollToNewest={shouldScrollToNewest}
        onScrolledToNewest={clearShouldScrollToNewest}
        onCommentDiscardRequest={onCommentDiscardRequest}
        commentDiscardDecision={commentDiscardDecision}
        onStartDetailTransition={(href) => {
          sessionStorage.setItem("freight:detail-expanding", "1");
          router.push(href);
        }}
        onTicketPurchaseRequest={onTicketPurchaseRequest}
        onTicketBought={handleTicketBought}
        onSettlementCompleted={handleSettlementCompleted}
        onSettlementInfoRequest={onSettlementInfoRequest}
      />
    </>
  );
}
