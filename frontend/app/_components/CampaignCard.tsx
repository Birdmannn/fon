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

type SettlementModalData = {
  campaignTitle: string;
  randomnessHash: string;
  randomnessPreimage: string | null;
  evidenceItems: string[];
  recipients: string[];
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
  onSettlementInfoRequest,
}: CampaignCardProps) {
  const state = useCampaignCardState({
    campaign,
    record,
    displayStatus,
    signer,
    client,
    currentWalletAddress,
    onCommentDiscardRequest,
    commentDiscardDecision,
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
            onClick={() => void state.handleLike()}
            className={`campaign-action-btn action-like ${state.userLiked ? "campaign-action-active" : ""} ${!state.isConnected ? "campaign-action-disabled" : ""}`}
            data-tooltip={!state.isConnected ? "Connect wallet to like" : "Like"}
          >
            <Heart className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
            <span className="campaign-action-count">{state.likes}</span>
          </button>

          <button
            onClick={state.handleBookmark}
            className={`campaign-action-btn action-bookmark ${state.userBookmarked ? "campaign-action-active" : ""} ${!state.isConnected ? "campaign-action-disabled" : ""}`}
            data-tooltip={!state.isConnected ? "Connect wallet to bookmark" : "Bookmark"}
          >
            <Bookmark className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
            <span className="campaign-action-count">{state.bookmarks}</span>
          </button>

          <button
            onClick={state.handleComment}
            className={`campaign-action-btn action-comment ${state.userCommented ? "campaign-action-active" : ""} ${!state.isConnected ? "campaign-action-disabled" : ""}`}
            data-tooltip={!state.isConnected ? "Connect wallet to comment" : "Comment"}
          >
            <MessageSquare className="campaign-action-icon" size={16} strokeWidth={2} aria-hidden="true" />
            <span className="campaign-action-count">{state.comments}</span>
          </button>

          <button
            onClick={state.handleReshare}
            className={`campaign-action-btn action-reshare ${state.userReshared ? "campaign-action-active" : ""} ${!state.isConnected ? "campaign-action-disabled" : ""}`}
            data-tooltip={!state.isConnected ? "Connect wallet to reshare" : "Reshare"}
          >
            <Repeat2 className="campaign-action-icon" size={22} strokeWidth={1.5} aria-hidden="true" />
            <span className="campaign-action-count">{state.reshares}</span>
          </button>

          {state.hasNotStartedRaffle && (
            <button
              type="button"
              disabled
              className="campaign-action-btn ml-auto campaign-action-disabled"
              data-tooltip="Ticket sales open after start delay"
            >
              <Coins className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
              <span className="campaign-action-count font-mono">{state.depositedCkb} CKB</span>
            </button>
          )}

          {state.isRaffleCampaign && displayStatus === CampaignStatus.Completed && state.soldTickets > 0n && (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => void state.handleSettlementClick()}
                className={`campaign-action-btn action-winners ${state.shouldGlowSettlement ? "campaign-action-active" : ""}`.trim()}
                data-tooltip={state.shouldGlowSettlement ? "Distribute raffle rewards" : "View raffle settlement evidence"}
              >
                <Share2 className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
                <span className="campaign-action-count">{String(state.soldTickets)}</span>
              </button>
              <button
                onClick={() => onTicketPurchaseRequest(campaign, record, onTicketBought)}
                disabled={state.isPurchaseDisabled}
                className={`campaign-action-btn ${state.isPurchaseDisabled ? "campaign-action-disabled" : ""}`.trim()}
                data-tooltip={!state.isConnected ? "Connect wallet to buy tickets" : "Freight unavailable"}
              >
                <Ticket className="campaign-action-icon" size={20} strokeWidth={2} aria-hidden="true" />
                <span className="campaign-action-count font-mono">{String(state.remainingTickets)} left</span>
              </button>
            </div>
          )}

          {!(state.isRaffleCampaign && displayStatus === CampaignStatus.Completed && state.soldTickets > 0n) && !state.hasNotStartedRaffle && (
            <button
              onClick={state.isRaffleCampaign ? () => onTicketPurchaseRequest(campaign, record, onTicketBought) : state.handleDepositClick}
              disabled={state.isPurchaseDisabled}
              className={`campaign-action-btn ml-auto ${state.isPurchaseDisabled ? "campaign-action-disabled" : ""}`.trim()}
              data-tooltip={
                !state.isConnected
                  ? (state.isRaffleCampaign ? "Connect wallet to buy tickets" : "Connect wallet to deposit")
                  : state.isCampaignInactive
                    ? "Freight unavailable"
                    : state.hasNoRemainingTickets
                      ? "No tickets left"
                      : state.hasReachedMaxAmount
                        ? "Max amount reached"
                        : (state.isRaffleCampaign ? "Buy tickets" : "Deposit CKB")
              }
            >
              {state.isRaffleCampaign ? (
                <>
                  <Ticket className="campaign-action-icon" size={20} strokeWidth={2} aria-hidden="true" />
                  <span className="campaign-action-count font-mono">{String(state.remainingTickets)} left</span>
                </>
              ) : (
                <>
                  <Coins className="campaign-action-icon" size={20} strokeWidth={2} aria-hidden="true" />
                  <span className="campaign-action-count font-mono">{state.depositedCkb} / {state.maxCkb} CKB</span>
                </>
              )}
            </button>
          )}
        </div>

        <div
          ref={state.commentComposerRef}
          className={`campaign-comment-composer ${state.isCommentComposerOpen ? "campaign-comment-composer-open" : "campaign-comment-composer-closed"}`}
          aria-hidden={!state.isCommentComposerOpen}
        >
          <div className="campaign-comment-input-wrap">
            <textarea
              ref={state.commentInputRef}
              value={state.commentDraft}
              onChange={(event) => {
                const nextValue = event.target.value.slice(0, 300);
                state.setCommentDraft(nextValue);
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
              disabled={state.isSavingComment || !state.isCommentComposerOpen}
            />
            <button
              type="button"
              className="campaign-comment-submit"
              onClick={() => void state.handleSubmitComment()}
              disabled={state.isSavingComment || !state.commentDraft.trim() || !state.isCommentComposerOpen}
              aria-label="Submit comment"
            >
              <Check size={24} strokeWidth={3} aria-hidden="true" />
            </button>
          </div>
          <div className="campaign-comment-meta-row">
            <span className={`campaign-comment-count ${state.commentDraft.length >= 300 ? "campaign-comment-count-limit" : state.commentDraft.length >= 250 ? "campaign-comment-count-warn" : ""}`}>{300 - state.commentDraft.length}</span>
          </div>
          {state.commentError ? <p className="campaign-comment-error">{state.commentError}</p> : null}
        </div>
      </div>

      {state.showDepositModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-4">Deposit CKB</h3>
            <form onSubmit={state.handleDepositSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Amount (CKB)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={Number(campaign.data.maximumAmount - campaign.data.currentDeposits) / 1e8}
                  value={state.depositAmount}
                  onChange={(e) => state.setDepositAmount(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                  disabled={state.isDepositing || state.isPurchaseDisabled}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Max available: {(Number(campaign.data.maximumAmount - campaign.data.currentDeposits) / 1e8).toFixed(2)} CKB
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    state.setShowDepositModal(false);
                    state.setDepositAmount("");
                  }}
                  disabled={state.isDepositing}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={state.isDepositing || !state.depositAmount || state.isPurchaseDisabled}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {state.isDepositing ? "Processing..." : "Deposit"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
