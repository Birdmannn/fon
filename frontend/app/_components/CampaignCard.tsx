"use client";

import { ccc } from "@ckb-ccc/connector-react";
import {
  Bookmark,
  Check,
  Coins,
  Heart,
  Infinity,
  MessageSquare,
  Repeat2,
  Share2,
  Ticket,
} from "lucide-react";

import CampaignCardSurface from "@/app/_components/CampaignCardSurface";
import { useInfoError } from "@/app/_components/InfoErrorProvider";
import { type CampaignRecord } from "@/app/_hooks/useCampaignFeed";
import CampaignApprovalControls from "@/app/_components/CampaignApprovalControls";
import { useCampaignCardState } from "@/app/_hooks/useCampaignCardState";
import { useUserProfile } from "@/app/_hooks/useUserProfile";
import type { SettlementModalData } from "@/app/_types/settlement";
import type { CampaignSupportRequest } from "@/app/_types/campaignSupport";
import { CampaignStatus } from "@/lib/contract";
import { decodeCreatedByAddress } from "@/lib/campaignDisplay";
import type { CampaignCell } from "@/lib/transactions";

type CampaignCardProps = {
  campaign: CampaignCell;
  record: CampaignRecord | null;
  displayStatus: CampaignStatus;
  signer: ccc.Signer | null;
  client: ccc.Client;
  currentViewerFbars?: number | null;
  currentWalletAddress: string | null;
  nowMs: number;
  isHighlighted?: boolean;
  onCommentDiscardRequest: (cardId: string) => void;
  commentDiscardDecision: { cardId: string; discard: boolean } | null;
  onOpenDetail: () => void;
  onMountablesClick: (record: CampaignRecord) => void;
  onFreightOptionsClick: () => void;
  onSupportRequest: (request: CampaignSupportRequest) => void;
  onTicketPurchaseRequest: (campaign: CampaignCell, record: CampaignRecord | null, liveSoldTickets: bigint, remainingTickets: bigint, onTicketBought: (campaignId: string, ticketPrice: bigint, nextSoldTickets: bigint) => void) => void;
  onTicketBought: (campaignId: string, ticketPrice: bigint, nextSoldTickets: bigint) => void;
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
  onSettlementInfoRequest: (data: SettlementModalData) => void;
};

export default function CampaignCard({
  campaign,
  record,
  displayStatus,
  signer,
  client,
  currentViewerFbars,
  currentWalletAddress,
  nowMs,
  isHighlighted = false,
  onCommentDiscardRequest,
  commentDiscardDecision,
  onOpenDetail,
  onMountablesClick,
  onFreightOptionsClick,
  onSupportRequest,
  onTicketPurchaseRequest,
  onTicketBought,
  onSettlementCompleted,
  onWithdrawalCompleted,
  onSettlementInfoRequest,
}: CampaignCardProps) {
  const creatorAddress = record?.creatorAddress || decodeCreatedByAddress(campaign);
  const { currentUserProfile: creatorProfile } = useUserProfile(null, null, creatorAddress);
  const {
    bookmarks,
    commentComposerRef,
    commentDraft,
    commentError,
    commentInputRef,
    comments,
    giftDeliverable,
    handleBookmark,
    handleComment,
    handleDepositSubmit,
    handleGiftClaim,
    handleGiftInfoClick,
    handleLike,
    handleReshare,
    handleSettlementClick,
    handleSubmitComment,
    handleWithdrawClick,
    hasNotStartedRaffle,
    isCampaignInactive,
    isCommentComposerOpen,
    isConnected,
    isLockedForInteractions,
    isSupportLocked,
    isWithdrawing,
    isPurchaseDisabled,
    isSupportDisabled,
    isRaffleCampaign,
    isRecurringRaffle,
    recurringActionLabel,
    isSavingComment,
    supportState,
    canGiftClaim,
    likes,
    lockAccessMessage,
    actionFeedback,
    remainingTickets,
    reshares,
    setCommentDraft,
    shouldGlowSettlement,
    showCreatorWithdrawAction,
    creatorWithdrawAmountCkb,
    supportDisplayCkb,
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
    currentViewerFbars,
    creatorCurrentFbars: creatorProfile?.fbars,
    currentWalletAddress,
    onCommentDiscardRequest,
    commentDiscardDecision,
    onSettlementCompleted,
    onWithdrawalCompleted,
    onSettlementInfoRequest,
  });
  useInfoError(actionFeedback?.tone === "error" ? actionFeedback.message : null);
  useInfoError(commentError);

  return (
    <div className="campaign-card-shell flex flex-col gap-0">
      <CampaignCardSurface
        campaign={campaign}
        record={record}
        creatorPhotoUpdatedAt={creatorProfile?.photoUpdatedAt}
        displayStatus={displayStatus}
        shouldGlowSettlement={shouldGlowSettlement}
        nowMs={nowMs}
        isHighlighted={isHighlighted}
        onOpenDetail={onOpenDetail}
        onMountablesClick={record ? () => onMountablesClick(record) : undefined}
        onFreightOptionsClick={onFreightOptionsClick}
      />

      <CampaignApprovalControls campaign={campaign} record={record} signer={signer} nowMs={nowMs} />

      <div className="flex flex-col gap-[0.45rem] pt-2 pb-[0.45rem] text-xs">
        <div className="flex items-center gap-2">
          <button
            onClick={() => void handleLike()}
            className={`campaign-action-btn action-like ${userLiked ? "campaign-action-active" : ""} ${!isConnected || isLockedForInteractions ? "campaign-action-disabled" : ""}`}
            data-tooltip={!isConnected ? "Connect wallet to like" : isLockedForInteractions ? lockAccessMessage : "Like"}
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
            className={`campaign-action-btn action-comment ${userCommented ? "campaign-action-active" : ""} ${!isConnected || isLockedForInteractions ? "campaign-action-disabled" : ""}`}
            data-tooltip={!isConnected ? "Connect wallet to comment" : isLockedForInteractions ? lockAccessMessage : "Comment"}
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
              onClick={() => onSupportRequest({ supportMode: supportState.supportMode, submit: handleDepositSubmit })}
              disabled={isSupportDisabled}
              className={`campaign-action-btn ml-auto ${isSupportDisabled ? "campaign-action-disabled" : ""}`.trim()}
              data-tooltip={
                !isConnected
                  ? `Connect wallet to ${supportState.supportMode === "direct_creator" ? "tip" : "deposit"}`
                  : isSupportLocked
                    ? lockAccessMessage
                    : !supportState.supportEnabled
                      ? "Support disabled for this freight"
                      : isCampaignInactive
                        ? "Freight unavailable"
                        : supportState.supportMode === "direct_creator"
                          ? "Tip creator"
                          : "Deposit CKB"
              }
            >
              <Coins className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
              <span className="campaign-action-count font-mono">{supportDisplayCkb} CKB</span>
            </button>
          )}

          {showSettlementAction && (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSettlementClick()}
                className={`campaign-action-btn action-winners ${shouldGlowSettlement ? "campaign-action-active" : ""}`.trim()}
                data-tooltip={isRecurringRaffle ? recurringActionLabel ?? "Recurring raffle action" : shouldGlowSettlement ? "Distribute raffle rewards" : "View raffle settlement evidence"}
              >
                <Share2 className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
                <span className="campaign-action-count">{String(soldTickets)}</span>
              </button>
              {showCreatorWithdrawAction ? (
                <button
                  type="button"
                  onClick={() => void handleWithdrawClick()}
                  disabled={isWithdrawing}
                  className={`campaign-action-btn ${isWithdrawing ? "campaign-action-disabled" : ""}`.trim()}
                  data-tooltip={isWithdrawing ? "Withdrawing creator support" : `Withdraw ${creatorWithdrawAmountCkb} CKB creator support`}
                >
                  <Coins className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
                  <span className="campaign-action-count font-mono">{isWithdrawing ? "..." : `${creatorWithdrawAmountCkb} CKB`}</span>
                </button>
              ) : null}
              <button
                onClick={() => onTicketPurchaseRequest(campaign, record, soldTickets, remainingTickets, onTicketBought)}
                disabled={isPurchaseDisabled}
                className={`campaign-action-btn ${isPurchaseDisabled ? "campaign-action-disabled" : ""}`.trim()}
                data-tooltip={!isConnected ? "Connect wallet to enter raffle" : isLockedForInteractions ? lockAccessMessage : "Freight unavailable"}
              >
                <Ticket className="campaign-action-icon" size={20} strokeWidth={2} aria-hidden="true" />
                <span className="campaign-action-count font-mono inline-flex items-center" aria-label={remainingTickets < 0n ? "Unlimited tickets" : undefined}>
                  {remainingTickets < 0n ? <Infinity size={22} strokeWidth={2} aria-hidden="true" /> : `${String(remainingTickets)} left`}
                </span>
              </button>
            </div>
          )}

          {!showSettlementAction && !hasNotStartedRaffle && (
            isRaffleCampaign ? (
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSupportRequest({ supportMode: supportState.supportMode, submit: handleDepositSubmit })}
                  disabled={isSupportDisabled}
                  className={`campaign-action-btn ${isSupportDisabled ? "campaign-action-disabled" : ""}`.trim()}
                  data-tooltip={
                    !isConnected
                      ? `Connect wallet to ${supportState.supportMode === "direct_creator" ? "tip" : "deposit"}`
                      : isSupportLocked
                        ? lockAccessMessage
                        : !supportState.supportEnabled
                          ? "Support disabled for this freight"
                          : isCampaignInactive
                            ? "Freight unavailable"
                            : supportState.supportMode === "direct_creator"
                              ? "Tip creator"
                              : "Deposit CKB"
                  }
                >
                  <Coins className="campaign-action-icon" size={20} strokeWidth={2} aria-hidden="true" />
                  <span className="campaign-action-count font-mono">{supportDisplayCkb} CKB</span>
                </button>
                {showCreatorWithdrawAction ? (
                  <button
                    type="button"
                    onClick={() => void handleWithdrawClick()}
                    disabled={isWithdrawing}
                    className={`campaign-action-btn ${isWithdrawing ? "campaign-action-disabled" : ""}`.trim()}
                    data-tooltip={isWithdrawing ? "Withdrawing creator support" : `Withdraw ${creatorWithdrawAmountCkb} CKB creator support`}
                  >
                    <Coins className="campaign-action-icon" size={20} strokeWidth={2} aria-hidden="true" />
                    <span className="campaign-action-count font-mono">{isWithdrawing ? "..." : `${creatorWithdrawAmountCkb} CKB`}</span>
                  </button>
                ) : null}
                <button
                  onClick={() => onTicketPurchaseRequest(campaign, record, soldTickets, remainingTickets, onTicketBought)}
                  disabled={isPurchaseDisabled}
                  className={`campaign-action-btn ${isPurchaseDisabled ? "campaign-action-disabled" : ""}`.trim()}
                  data-tooltip={
                    !isConnected
                      ? "Connect wallet to buy tickets"
                      : isLockedForInteractions
                        ? lockAccessMessage
                        : isCampaignInactive
                          ? "Freight unavailable"
                          : hasNotStartedRaffle
                            ? "Raffle has not started"
                            : remainingTickets === 0n
                              ? "No tickets left"
                              : campaign.data.auxAmount === 0n ? "Enter raffle" : "Buy tickets"
                  }
                >
                  <Ticket className="campaign-action-icon" size={20} strokeWidth={2} aria-hidden="true" />
                  <span className="campaign-action-count font-mono inline-flex items-center" aria-label={remainingTickets < 0n ? "Unlimited tickets" : undefined}>
                    {remainingTickets < 0n ? <Infinity size={22} strokeWidth={2} aria-hidden="true" /> : `${String(remainingTickets)} left`}
                  </span>
                </button>
              </div>
            ) : (
              <button
                onClick={() => onSupportRequest({ supportMode: supportState.supportMode, submit: handleDepositSubmit })}
                disabled={isSupportDisabled}
                className={`campaign-action-btn ml-auto ${isSupportDisabled ? "campaign-action-disabled" : ""}`.trim()}
                data-tooltip={
                  !isConnected
                    ? `Connect wallet to ${supportState.supportMode === "direct_creator" ? "tip" : "deposit"}`
                    : isSupportLocked
                      ? lockAccessMessage
                      : !supportState.supportEnabled
                        ? "Support disabled for this freight"
                      : isCampaignInactive
                        ? "Freight unavailable"
                        : supportState.supportMode === "direct_creator" ? "Tip creator" : "Deposit CKB"
                }
              >
                <Coins className="campaign-action-icon" size={20} strokeWidth={2} aria-hidden="true" />
                <span className="campaign-action-count font-mono">{supportDisplayCkb} CKB</span>
              </button>
            )
          )}

          {giftDeliverable.enabled ? (
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={handleGiftInfoClick}
                className="campaign-action-btn action-gift"
                data-tooltip="Gift details"
              >
                <Share2 className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
                <span className="campaign-action-count">gift</span>
              </button>
              {canGiftClaim ? (
                <button
                  type="button"
                  onClick={() => void handleGiftClaim()}
                  className="campaign-action-btn action-gift-claim"
                  data-tooltip="Claim gift"
                >
                  <Coins className="campaign-action-icon" size={18} strokeWidth={2} aria-hidden="true" />
                  <span className="campaign-action-count">claim</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {actionFeedback?.tone === "success" ? (
          <p className="campaign-action-feedback campaign-action-feedback-success">
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
        </div>
      </div>

    </div>
  );
}
