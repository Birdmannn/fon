"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ccc } from "@ckb-ccc/connector-react";

import { useUserProfile } from "@/app/_hooks/useUserProfile";
import FreightInfoModal from "@/app/_components/FreightInfoModal";
import { lockBodyScroll } from "@/app/_lib/bodyScrollLock";

const MOUNTABLES_PLACEHOLDER_MESSAGE = "Raffle · Forms · Locks · Public Payment Streaming ·   ";
const MAX_WEEKLY_MARQUEE_MESSAGE_LENGTH = 120;
const INFO_MODAL_ANIMATION_MS = 620;

function buildMarqueeCopy(message: string, ownerLabel?: string | null) {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return MOUNTABLES_PLACEHOLDER_MESSAGE;
  }

  return `${ownerLabel ? `${ownerLabel}: ` : ""}${trimmedMessage} ·   `;
}

export default function MountablesPanel() {
  const signer = ccc.useSigner();
  const {
    activeWeeklyMarqueeEditsRemaining,
    activeWeeklyMarqueeMaxEdits,
    activeWeeklyMarqueeMessage,
    activeWeeklyMarqueeOwner,
    currentUserProfile,
    isSavingUserProfile,
    saveWeeklyMarqueeMessage,
    userProfileError,
  } = useUserProfile(signer ?? null);
  const [marqueeDraft, setMarqueeDraft] = useState("");
  const [marqueeError, setMarqueeError] = useState("");
  const [isEditingMarquee, setIsEditingMarquee] = useState(false);
  const [isMarqueeModalClosing, setIsMarqueeModalClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isEditingMarquee) return;
    return lockBodyScroll();
  }, [isEditingMarquee]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const canEditMarquee = Boolean(currentUserProfile?.canEditWeeklyMarquee);
  const ownerLabel = typeof activeWeeklyMarqueeOwner?.displayName === "string" && activeWeeklyMarqueeOwner.displayName.trim().length > 0
    ? activeWeeklyMarqueeOwner.displayName.trim()
    : activeWeeklyMarqueeOwner?.handle ?? null;
  const marqueeCopy = useMemo(
    () => MOUNTABLES_PLACEHOLDER_MESSAGE + (activeWeeklyMarqueeMessage ? buildMarqueeCopy(activeWeeklyMarqueeMessage, ownerLabel) : ""),
    [activeWeeklyMarqueeMessage, ownerLabel],
  );
  const marqueeText = marqueeCopy.repeat(3);
  const remainingLabel = `${activeWeeklyMarqueeEditsRemaining}/${activeWeeklyMarqueeMaxEdits} edits left this week`;

  const closeMarqueeModal = () => {
    if (isSavingUserProfile || isMarqueeModalClosing) return;
    setIsMarqueeModalClosing(true);
    closeTimerRef.current = setTimeout(() => {
      setIsEditingMarquee(false);
      setIsMarqueeModalClosing(false);
      setMarqueeError("");
      closeTimerRef.current = null;
    }, INFO_MODAL_ANIMATION_MS);
  };

  const handleMarqueeClick = () => {
    if (!canEditMarquee || isSavingUserProfile || isEditingMarquee) {
      return;
    }

    setMarqueeError("");
    setMarqueeDraft(activeWeeklyMarqueeMessage ?? "");
    setIsEditingMarquee(true);
  };

  const handleMarqueeSave = async () => {
    try {
      setMarqueeError("");
      await saveWeeklyMarqueeMessage(marqueeDraft.trim());
      closeMarqueeModal();
    } catch (error) {
      setMarqueeError(error instanceof Error ? error.message : "Failed to update weekly marquee message");
    }
  };

  return (
    <div className="retro-mountables-shell" aria-label="Mountables display">
      <button
        type="button"
        className={`retro-marquee-button ${canEditMarquee ? "retro-marquee-button-editable" : ""}`.trim()}
        onClick={handleMarqueeClick}
        disabled={!canEditMarquee}
        aria-label={canEditMarquee ? "Edit weekly marquee message" : "Weekly marquee display"}
        data-tooltip={canEditMarquee ? `Click to edit weekly marquee — ${remainingLabel}` : undefined}
      >
        <div className="retro-marquee-track">
          <span>{marqueeText}</span>
          <span aria-hidden="true">{marqueeText}</span>
        </div>
      </button>

      {isEditingMarquee && typeof document !== "undefined" ? createPortal(
        <div className="marquee-info-modal-anchor"><FreightInfoModal
          open
          closing={isMarqueeModalClosing}
          ariaLabel="New marquee message"
          backdropAriaLabel="Close marquee editor"
          backdropInteractive={!isSavingUserProfile && !isMarqueeModalClosing}
          onRequestClose={closeMarqueeModal}
          onKeepOpen={() => undefined}
          onScheduleClose={() => undefined}
          body={
            <div className="create-info-constraints-copy">
              <div className="create-info-section-heading-row">
                <p className="create-review-section-label campaign-freight-options-heading font-bold">New Marquee Message:</p>
                {marqueeError || userProfileError ? (
                  <p className="create-review-section-label create-info-inline-status text-red-500" role="alert">{marqueeError || userProfileError}</p>
                ) : null}
              </div>
            </div>
          }
          actions={
            <form className="create-info-confirm-actions flex-col gap-2" onSubmit={(event) => { event.preventDefault(); void handleMarqueeSave(); }}>
              <input
                type="text"
                value={marqueeDraft}
                maxLength={MAX_WEEKLY_MARQUEE_MESSAGE_LENGTH}
                onChange={(event) => {
                  setMarqueeDraft(event.target.value);
                  if (marqueeError) setMarqueeError("");
                }}
                className="create-info-ticket-input"
                aria-label="New marquee message"
                disabled={isSavingUserProfile}
                autoFocus
              />
              <button type="submit" className="create-info-confirm-btn create-info-confirm-btn-primary" disabled={isSavingUserProfile || !marqueeDraft.trim()}>
                {isSavingUserProfile ? "Saving..." : "Continue"}
              </button>
            </form>
          }
        /></div>,
        document.body,
      ) : null}
    </div>
  );
}
