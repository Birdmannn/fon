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
  onProfileDataChanged,
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
        }}
        onSettlementInfoRequest={onSettlementInfoRequest}
      />
    </>
  );
}
