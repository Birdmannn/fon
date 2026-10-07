"use client";

import { ccc } from "@ckb-ccc/connector-react";
import { Bookmark, Check, Coins, Heart, Repeat2, Share2, Ticket, X } from "lucide-react";
import { useEffect, useState } from "react";

import CampaignCommentsPanel from "@/app/_components/CampaignCommentsPanel";
import CampaignDetailSurface from "@/app/_components/CampaignDetailSurface";
import CampaignMountablesPanel, { type CampaignMountableItem } from "@/app/_components/CampaignMountablesPanel";
import CampaignParticipantsStack from "@/app/_components/CampaignParticipantsStack";
import { useCampaignCardState } from "@/app/_hooks/useCampaignCardState";
import type { CampaignSupportRequest } from "@/app/_types/campaignSupport";
import type { CampaignRecord } from "@/app/_types/campaignRecords";
import type { SettlementModalData } from "@/app/_types/settlement";
import { decodeCreatedByAddress, deriveDisplayStatus } from "@/lib/campaignDisplay";
import type { CampaignCell } from "@/lib/transactions";

type Props = {
  campaign: CampaignCell;
  record: CampaignRecord;
  client: ccc.Client;
  signer: ccc.Signer | null;
  walletAddress: string | null;
  viewerFbars: number | null | undefined;
  creatorFbars: number | null | undefined;
  walletPhotoUpdatedAt: string | null;
  nowMs: number;
  mountableItems: CampaignMountableItem[];
  onProfileDataChanged: () => void;
  onViewerAvatarClick: () => void;
  onSupportRequest: (request: CampaignSupportRequest) => void;
  onTicketPurchaseRequest: (campaign: CampaignCell, record: CampaignRecord, liveSoldTickets: bigint, remainingTickets: bigint, onTicketBought: (campaignId: string, ticketPrice: bigint, nextSoldTickets: bigint) => void) => void;
};

type Modal = "settlement" | null;

export default function CampaignDetailInteractions({
  campaign, record: initialRecord, client, signer, walletAddress, viewerFbars, creatorFbars,
  walletPhotoUpdatedAt, nowMs, mountableItems, onProfileDataChanged, onViewerAvatarClick, onSupportRequest, onTicketPurchaseRequest,
}: Props) {
  const [record, setRecord] = useState(initialRecord);
  const onRecordChange = (update: Partial<CampaignRecord>) => setRecord((current) => ({ ...current, ...update }));
  useEffect(() => setRecord(initialRecord), [initialRecord]);
  const [modal, setModal] = useState<Modal>(null);
  const [settlement, setSettlement] = useState<SettlementModalData | null>(null);
  const state = useCampaignCardState({
    campaign,
    record,
    displayStatus: deriveDisplayStatus(campaign, nowMs),
    signer,
    client,
    currentViewerFbars: viewerFbars,
    creatorCurrentFbars: creatorFbars,
    currentWalletAddress: walletAddress,
    onCommentDiscardRequest: () => {},
    commentDiscardDecision: null,
    persistentCommentComposer: true,
    onSettlementCompleted: (_id, settlementTxHash, settledAt, soldTicketCount, settledParticipantCount, settledRecipients) => {
      onRecordChange({ settlementTxHash, settledAt, soldTicketCount, settledParticipantCount, settledRecipients });
      onProfileDataChanged();
    },
    onWithdrawalCompleted: (_id, withdrawalTxHash, withdrawnAt, withdrawnByAddress, withdrawnAmountShannons) => {
      onRecordChange({ withdrawalTxHash, withdrawnAt, withdrawnByAddress, withdrawnAmountShannons });
      onProfileDataChanged();
    },
    onSettlementInfoRequest: (data) => {
      setSettlement(data);
      setModal("settlement");
    },
  });

  const creatorAddress = record.creatorAddress || decodeCreatedByAddress(campaign);
  const openSupport = () => {
    onSupportRequest({ supportMode: state.supportState.supportMode, submit: state.handleDepositSubmit });
  };
  const openTickets = () => {
    onTicketPurchaseRequest(campaign, record, state.soldTickets, state.remainingTickets, (_id, _ticketPrice, nextSoldTickets) => {
      onRecordChange({ liveSoldTicketCount: String(nextSoldTickets) });
    });
  };
  const supportButton = (
    <button type="button" className="campaign-action-btn campaign-detail-icon-action" onClick={openSupport} disabled={state.isSupportDisabled}
      aria-label={state.supportState.supportMode === "direct_creator" ? "Tip creator" : "Deposit CKB"}
      title={state.isSupportDisabled ? state.isSupportLocked ? state.lockAccessMessage : "Support unavailable" : state.supportState.supportMode === "direct_creator" ? "Tip creator" : "Deposit CKB"}>
      <Coins className="campaign-action-icon" size={30} aria-hidden="true" />
    </button>
  );
  const ticketButton = (
    <button type="button" className="campaign-action-btn campaign-detail-icon-action" onClick={openTickets} disabled={state.isPurchaseDisabled}
      aria-label={campaign.data.auxAmount === 0n ? "Enter raffle" : "Buy tickets"}
      title={state.isPurchaseDisabled ? "Raffle entry unavailable" : campaign.data.auxAmount === 0n ? "Enter raffle" : "Buy tickets"}>
      <Ticket className="campaign-action-icon" size={30} aria-hidden="true" />
    </button>
  );

  return (
    <>
      <div className="campaign-detail-content campaign-detail-interactive-content">
        <section className="campaign-detail-post-column campaign-card-entry">
          <div className="campaign-detail-card-shell">
            <CampaignDetailSurface campaign={campaign} record={record} nowMs={nowMs} />
          </div>
        </section>

        <section className="campaign-detail-comments-column campaign-card-entry">
          <div className="campaign-detail-right-top">
            <CampaignMountablesPanel items={mountableItems} />
            {state.isRaffleCampaign ? (
              <div className="campaign-detail-raffle-actions">
                {supportButton}
                {state.showCreatorWithdrawAction ? (
                  <button type="button" className="campaign-action-btn campaign-detail-icon-action" onClick={() => void state.handleWithdrawClick()} disabled={state.isWithdrawing}
                    aria-label="Withdraw creator support"
                    title={`Withdraw ${state.creatorWithdrawAmountCkb} CKB creator support`}>
                    <Coins size={30} aria-hidden="true" />
                  </button>
                ) : null}
                {ticketButton}
              </div>
            ) : null}
          </div>
          <CampaignParticipantsStack campaignId={record.campaignId ?? null} walletAddress={walletAddress} walletPhotoUpdatedAt={walletPhotoUpdatedAt} onViewerAvatarClick={onViewerAvatarClick} />
          <div className="campaign-detail-action-rail" aria-label="Freight actions">
            <button type="button" className={`campaign-action-btn action-like ${state.userLiked ? "campaign-action-active" : ""}`}
              onClick={() => void state.handleLike()} title={!state.isConnected ? "Connect wallet to like" : "Like"}>
              <Heart size={18} aria-hidden="true" /><span className="campaign-action-count">{state.likes}</span>
            </button>
            <button type="button" className={`campaign-action-btn action-bookmark ${state.userBookmarked ? "campaign-action-active" : ""}`}
              onClick={state.handleBookmark} title={!state.isConnected ? "Connect wallet to bookmark" : "Bookmark"}>
              <Bookmark size={18} aria-hidden="true" /><span className="campaign-action-count">{state.bookmarks}</span>
            </button>
            <button type="button" className={`campaign-action-btn action-reshare ${state.userReshared ? "campaign-action-active" : ""}`}
              onClick={() => void state.handleReshare()} title="Share">
              <Repeat2 size={21} aria-hidden="true" /><span className="campaign-action-count">{state.reshares}</span>
            </button>
            {state.showSettlementAction ? (
              <button type="button" className={`campaign-action-btn action-winners ${state.shouldGlowSettlement ? "campaign-action-active" : ""}`}
                onClick={() => void state.handleSettlementClick()} title={state.isRecurringRaffle ? state.recurringActionLabel ?? "Recurring raffle action" : state.shouldGlowSettlement ? "Distribute raffle rewards" : "View raffle settlement evidence"}>
                <Share2 size={18} aria-hidden="true" /><span className="campaign-action-count">{String(state.soldTickets)}</span>
              </button>
            ) : null}
            {!state.isRaffleCampaign ? supportButton : null}
            {state.giftDeliverable.enabled ? (
              <>
                <button type="button" className="campaign-action-btn action-gift" onClick={state.handleGiftInfoClick} title="Gift details">
                  <Share2 size={18} aria-hidden="true" /><span className="campaign-action-count">gift</span>
                </button>
                {state.canGiftApprove ? <button type="button" className="campaign-action-btn action-gift-approve" onClick={() => void state.handleGiftApprove()} title="Approve gift"><Check size={18} aria-hidden="true" /><span className="campaign-action-count">approve</span></button> : null}
                {state.canGiftClaim ? <button type="button" className="campaign-action-btn action-gift-claim" onClick={() => void state.handleGiftClaim()} title="Claim gift"><Coins size={18} aria-hidden="true" /><span className="campaign-action-count">claim</span></button> : null}
              </>
            ) : null}
            {state.actionFeedback ? <p className={`campaign-action-feedback campaign-action-feedback-${state.actionFeedback.tone}`} role="status">{state.actionFeedback.message}</p> : null}
          </div>
        </section>

        <div className="campaign-detail-comment-area">
          <div ref={state.commentComposerRef} className="campaign-comment-composer campaign-comment-composer-open">
            <div className="campaign-comment-input-wrap">
              <textarea ref={state.commentInputRef} className="campaign-comment-input" rows={1} value={state.commentDraft}
                placeholder="Type something..." maxLength={300} disabled={state.isSavingComment || !state.isConnected || state.isLockedForInteractions}
                onChange={(event) => {
                  state.setCommentDraft(event.target.value);
                  event.currentTarget.style.height = "auto";
                  event.currentTarget.style.height = `${Math.max(32, event.currentTarget.scrollHeight)}px`;
                }} />
              <button type="button" className="campaign-comment-submit" onClick={() => void state.handleSubmitComment()}
                disabled={state.isSavingComment || !state.commentDraft.trim() || !state.isConnected || state.isLockedForInteractions} aria-label="Submit comment">
                <Check size={24} strokeWidth={3} aria-hidden="true" />
              </button>
            </div>
            <div className="campaign-comment-meta-row"><span className="campaign-comment-count">{300 - state.commentDraft.length}</span></div>
            {state.commentError ? <p className="campaign-comment-error" role="alert">{state.commentError}</p> : null}
          </div>
          <CampaignCommentsPanel comments={state.commentList} fallbackAddress={creatorAddress} showHeader={false} showEmptyState={false} variant="inline" />
        </div>
      </div>

      {modal ? (
        <div className="campaign-detail-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
          <div className="campaign-detail-modal" role="dialog" aria-modal="true" aria-label="Freight details">
            <button type="button" className="campaign-detail-modal-close" onClick={() => setModal(null)} aria-label="Close"><X size={18} /></button>
              <div><h2>{settlement?.campaignTitle ?? "Freight details"}</h2>
                {settlement?.gift ? <p>{settlement.gift.claimantsLabel} | {settlement.gift.approvalCount}/{settlement.gift.requiredApprovalCount ?? 0} approvals</p> : null}
                {(settlement?.evidenceItems ?? []).map((item) => <p key={item}>{item}</p>)}
                {(settlement?.recipients ?? []).map((recipient, index) => <p key={`${recipient.handle}-${index}`}>{recipient.handle}: {recipient.amountLabel}</p>)}
                {settlement?.errorMessage ? <p className="campaign-comment-error">{settlement.errorMessage}</p> : null}
                {settlement?.distributionTxHash ? <a href={`https://pudge.explorer.nervos.org/transaction/${settlement.distributionTxHash}`} target="_blank" rel="noopener noreferrer" className="break-all underline">{settlement.distributionTxHash}</a> : null}
              </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
