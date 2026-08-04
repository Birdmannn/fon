"use client";

import { useMemo, useState } from "react";

import { ccc } from "@ckb-ccc/connector-react";

import { useUserProfile } from "@/app/_hooks/useUserProfile";

const MOUNTABLES_PLACEHOLDER_MESSAGE = "Raffle · Forms · Locks · Public Payment Streaming ·   ";
const MAX_WEEKLY_MARQUEE_MESSAGE_LENGTH = 120;

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

  const canEditMarquee = Boolean(currentUserProfile?.canEditWeeklyMarquee);
  const ownerLabel = typeof activeWeeklyMarqueeOwner?.displayName === "string" && activeWeeklyMarqueeOwner.displayName.trim().length > 0
    ? activeWeeklyMarqueeOwner.displayName.trim()
    : activeWeeklyMarqueeOwner?.handle ?? null;
  const marqueeCopy = useMemo(
    () => activeWeeklyMarqueeMessage ? buildMarqueeCopy(activeWeeklyMarqueeMessage, ownerLabel) : MOUNTABLES_PLACEHOLDER_MESSAGE,
    [activeWeeklyMarqueeMessage, ownerLabel],
  );
  const marqueeText = `${marqueeCopy}${marqueeCopy}${marqueeCopy}`;
  const editorLabel = ownerLabel || "Weekly winner";
  const remainingLabel = `${activeWeeklyMarqueeEditsRemaining}/${activeWeeklyMarqueeMaxEdits} edits left this week`;
  const displayError = marqueeError || userProfileError;

  const handleMarqueeClick = () => {
    if (!canEditMarquee || isSavingUserProfile) {
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
      setIsEditingMarquee(false);
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
        title={canEditMarquee ? `Click to edit weekly marquee — ${remainingLabel}` : undefined}
      >
        <div className="retro-marquee-track">
          <span>{marqueeText}</span>
          <span aria-hidden="true">{marqueeText}</span>
        </div>
      </button>

      {isEditingMarquee ? (
        <div className="retro-marquee-editor">
          <p className="retro-marquee-editor-label">Weekly marquee for {editorLabel}</p>
          <p className="retro-marquee-editor-label">{remainingLabel}</p>
          <div className="retro-marquee-editor-row">
            <input
              type="text"
              value={marqueeDraft}
              maxLength={MAX_WEEKLY_MARQUEE_MESSAGE_LENGTH}
              onChange={(event) => {
                setMarqueeDraft(event.target.value);
                if (marqueeError) {
                  setMarqueeError("");
                }
              }}
              className="retro-marquee-editor-input"
              aria-label="Weekly marquee message"
              disabled={isSavingUserProfile}
            />
            <button
              type="button"
              className="retro-marquee-editor-action"
              onClick={() => void handleMarqueeSave()}
              disabled={isSavingUserProfile}
            >
              {isSavingUserProfile ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="retro-marquee-editor-action retro-marquee-editor-action-secondary"
              onClick={() => {
                setIsEditingMarquee(false);
                setMarqueeError("");
              }}
              disabled={isSavingUserProfile}
            >
              Cancel
            </button>
          </div>
          {displayError ? <p className="retro-marquee-editor-error">{displayError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
