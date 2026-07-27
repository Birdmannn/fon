"use client";

import { ccc } from "@ckb-ccc/connector-react";
import {
  Bookmark,
  Check,
  Coins,
  Heart,
  MessageSquare,
  Repeat2,
  Share2,
  Ticket,
} from "lucide-react";

import CampaignCardSurface from "@/app/_components/CampaignCardSurface";
import { type CampaignRecord } from "@/app/_hooks/useCampaignFeed";
import { useCampaignCardState } from "@/app/_hooks/useCampaignCardState";
import { CampaignStatus } from "@/lib/contract";
import type { CampaignCell } from "@/lib/transactions";

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

type CampaignCardProps = {
  campaign: CampaignCell;
  record: CampaignRecord | null;
  displayStatus: CampaignStatus;
  signer: ccc.Signer | null;
  client: ccc.Client;
  currentWalletAddress: string | null;
  nowMs: number;
  isHighlighted?: boolean;
  onCommentDiscardRequest: (cardId: string) => void;
  commentDiscardDecision: { cardId: string; discard: boolean } | null;
  onOpenDetail: () => void;
  onTicketPurchaseRequest: (campaign: CampaignCell, record: CampaignRecord | null, onTicketBought: (campaignId: string, ticketPrice: bigint) => void) => void;
  onTicketBought: (campaignId: string, ticketPrice: bigint) => void;
  onSettlementCompleted: (
    campaignId: string,
    settlementTxHash: string,
    settledAt: string,
    soldTicketCount: string,
    settledParticipantCount?: string | null,
    settledRecipients?: CampaignRecord["settledRecipients"]
  ) => void;
  onSettlementInfoRequest: (data: SettlementModalData) => void;
};

export default function CampaignCard({
  campaign,
  record,
  displayStatus,
  signer,
  client,
  currentWalletAddress,
  nowMs,
  isHighlighted = false,
  onCommentDiscardRequest,
  commentDiscardDecision,
  onOpenDetail,
  onTicketPurchaseRequest,
  onTicketBought,
  onSettlementCompleted,
  onSettlementInfoRequest,
}: CampaignCardProps) {
  const {
    bookmarks,
    commentComposerRef,
    commentDraft,
    commentError,
    commentInputRef,
    comments,
    depositAmount,
    depositedCkb,
    handleBookmark,
    handleComment,
    handleDepositClick,
    handleDepositSubmit,
    handleLike,
    handleReshare,
    handleSettlementClick,
    handleSubmitComment,
    hasNotStartedRaffle,
    hasReachedMaxAmount,
    isCampaignInactive,
    isCommentComposerOpen,
    isConnected,
    isDepositing,
    isPurchaseDisabled,
    isRaffleCampaign,
    isSavingComment,
    likes,
    actionFeedback,
    maxCkb,
    remainingTickets,
    reshares,
    setCommentDraft,
    setDepositAmount,
    setShowDepositModal,
    shouldGlowSettlement,
    showDepositModal,
    showSettlementAction,
    soldTickets,
    userBookmarked,
    userCommented,
    userLiked,
    userReshared,
  } = useCampaignCardState({
    campaign,
    record,
    displayStatus,
    signer,
    client,
    currentWalletAddress,
    onCommentDiscardRequest,
    commentDiscardDecision,
    onSettlementCompleted,
    onSettlementInfoRequest,
  });

  return (
    <div className="campaign-card-shell flex flex-col gap-0">
      <CampaignCardSurface
        campaign={campaign}
        record={record}
        displayStatus={displayStatus}
        nowMs={nowMs}
        isHighlighted={isHighlighted}
        onOpenDetail={onOpenDetail}
      />

      <div className="flex flex-col gap-3 pt-2 pb-3 text-xs">
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleLike()}
            className={`campaign-action-btn action-like ${userLiked ? "campaign-action-active" : ""} ${!isConnected ? "campaign-action-disabled" : ""}`}
            data-tooltip={!isConnected ? "Connect wallet to like" : "Like"}
          >
            <Heart className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
            <span className="campaign-action-count">{likes}</span>
          </button>

          <button
            onClick={handleBookmark}
            className={`campaign-action-btn action-bookmark ${userBookmarked ? "campaign-action-active" : ""} ${!isConnected ? "campaign-action-disabled" : ""}`}
            data-tooltip={!isConnected ? "Connect wallet to bookmark" : "Bookmark"}
          >
            <Bookmark className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
            <span className="campaign-action-count">{bookmarks}</span>
          </button>

          <button
            onClick={handleComment}
            className={`campaign-action-btn action-comment ${userCommented ? "campaign-action-active" : ""} ${!isConnected ? "campaign-action-disabled" : ""}`}
            data-tooltip={!isConnected ? "Connect wallet to comment" : "Comment"}
          >
            <MessageSquare className="campaign-action-icon" size={16} strokeWidth={2} aria-hidden="true" />
            <span className="campaign-action-count">{comments}</span>
          </button>

          <button
            onClick={() => void handleReshare()}
            className={`campaign-action-btn action-reshare ${userReshared ? "campaign-action-active" : ""}`.trim()}
            data-tooltip="Share"
          >
            <Repeat2 className="campaign-action-icon" size={22} strokeWidth={1.5} aria-hidden="true" />
            <span className="campaign-action-count">{reshares}</span>
          </button>

          {hasNotStartedRaffle && (
            <button
              type="button"
              disabled
              className="campaign-action-btn ml-auto campaign-action-disabled"
              data-tooltip="Funding coming soon"
            >
              <Coins className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
              <span className="campaign-action-count font-mono">{depositedCkb} CKB</span>
            </button>
          )}

          {showSettlementAction && (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSettlementClick()}
                className={`campaign-action-btn action-winners ${shouldGlowSettlement ? "campaign-action-active" : ""}`.trim()}
                data-tooltip={shouldGlowSettlement ? "Distribute raffle rewards" : "View raffle settlement evidence"}
              >
                <Share2 className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
                <span className="campaign-action-count">{String(soldTickets)}</span>
              </button>
              <button
                onClick={() => onTicketPurchaseRequest(campaign, record, onTicketBought)}
                disabled={isPurchaseDisabled}
                className={`campaign-action-btn ${isPurchaseDisabled ? "campaign-action-disabled" : ""}`.trim()}
                data-tooltip={!isConnected ? "Connect wallet to buy tickets" : "Freight unavailable"}
              >
                <Ticket className="campaign-action-icon" size={20} strokeWidth={2} aria-hidden="true" />
                <span className="campaign-action-count font-mono">{String(remainingTickets)} left</span>
              </button>
            </div>
          )}

          {!showSettlementAction && !hasNotStartedRaffle && (
            <button
              onClick={isRaffleCampaign ? () => onTicketPurchaseRequest(campaign, record, onTicketBought) : handleDepositClick}
              disabled={isPurchaseDisabled}
              className={`campaign-action-btn ml-auto ${isPurchaseDisabled ? "campaign-action-disabled" : ""}`.trim()}
              data-tooltip={
                !isConnected
                  ? (isRaffleCampaign ? "Connect wallet to buy tickets" : "Connect wallet to deposit")
                  : isCampaignInactive
                    ? "Freight unavailable"
                    : remainingTickets <= 0n
                      ? "No tickets left"
                      : hasReachedMaxAmount
                        ? "Max amount reached"
                        : (isRaffleCampaign ? "Buy tickets" : "Deposit CKB")
              }
            >
              {isRaffleCampaign ? (
                <>
                  <Ticket className="campaign-action-icon" size={20} strokeWidth={2} aria-hidden="true" />
                  <span className="campaign-action-count font-mono">{String(remainingTickets)} left</span>
                </>
              ) : (
                <>
                  <Coins className="campaign-action-icon" size={20} strokeWidth={2} aria-hidden="true" />
                  <span className="campaign-action-count font-mono">{depositedCkb} / {maxCkb} CKB</span>
                </>
              )}
            </button>
          )}
        </div>

        {actionFeedback ? (
          <p className={`campaign-action-feedback ${actionFeedback.tone === "error" ? "campaign-action-feedback-error" : "campaign-action-feedback-success"}`.trim()}>
            {actionFeedback.message}
          </p>
        ) : null}

        <div
          ref={commentComposerRef}
          className={`campaign-comment-composer ${isCommentComposerOpen ? "campaign-comment-composer-open" : "campaign-comment-composer-closed"}`}
          aria-hidden={!isCommentComposerOpen}
        >
          <div className="campaign-comment-input-wrap">
            <textarea
              ref={commentInputRef}
              value={commentDraft}
              onChange={(event) => {
                const nextValue = event.target.value.slice(0, 300);
                setCommentDraft(nextValue);
                event.currentTarget.value = nextValue;
                event.currentTarget.style.height = "auto";
                const nextHeight = Math.max(32, event.currentTarget.scrollHeight);
                event.currentTarget.style.height = `${nextHeight}px`;
              }}
              onFocus={(event) => {
                if (event.currentTarget.value.length > 0) {
                  event.currentTarget.select();
                }
              }}
              className="campaign-comment-input"
              placeholder="Write a comment..."
              rows={1}
              disabled={isSavingComment || !isCommentComposerOpen}
            />
            <button
              type="button"
              className="campaign-comment-submit"
              onClick={() => void handleSubmitComment()}
              disabled={isSavingComment || !commentDraft.trim() || !isCommentComposerOpen}
              aria-label="Submit comment"
            >
              <Check size={24} strokeWidth={3} aria-hidden="true" />
            </button>
          </div>
          <div className="campaign-comment-meta-row">
            <span className={`campaign-comment-count ${commentDraft.length >= 300 ? "campaign-comment-count-limit" : commentDraft.length >= 250 ? "campaign-comment-count-warn" : ""}`}>{300 - commentDraft.length}</span>
          </div>
          {commentError ? <p className="campaign-comment-error">{commentError}</p> : null}
        </div>
      </div>

      {showDepositModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-4">Deposit CKB</h3>
            <form onSubmit={handleDepositSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Amount (CKB)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={Number(campaign.data.maximumAmount - campaign.data.currentDeposits) / 1e8}
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                  disabled={isDepositing || isPurchaseDisabled}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Max available: {(Number(campaign.data.maximumAmount - campaign.data.currentDeposits) / 1e8).toFixed(2)} CKB
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowDepositModal(false);
                    setDepositAmount("");
                  }}
                  disabled={isDepositing}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDepositing || !depositAmount || isPurchaseDisabled}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {isDepositing ? "Processing..." : "Deposit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
