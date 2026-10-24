"use client";

import { useFreightSigner } from "@/app/_components/OwlWalletProvider";

import { useMemo } from "react";

import { useUserProfile } from "@/app/_hooks/useUserProfile";

const MOUNTABLES_PLACEHOLDER_MESSAGE = "Raffle · Forms · Locks · Public Payment Streaming ·   ";

function buildMarqueeCopy(message: string, ownerLabel?: string | null) {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return MOUNTABLES_PLACEHOLDER_MESSAGE;
  }

  return `${ownerLabel ? `${ownerLabel}: ` : ""}${trimmedMessage} ·   `;
}

export default function MountablesPanel({ onEditMarquee }: { onEditMarquee: () => void }) {
  const signer = useFreightSigner();
  const {
    activeWeeklyMarqueeEditsRemaining,
    activeWeeklyMarqueeMaxEdits,
    activeWeeklyMarqueeMessage,
    activeWeeklyMarqueeOwner,
    currentUserProfile,
  } = useUserProfile(signer ?? null);

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

  return (
    <div className="retro-mountables-shell" aria-label="Mountables display">
      <button
        type="button"
        className={`retro-marquee-button ${canEditMarquee ? "retro-marquee-button-editable" : ""}`.trim()}
        onClick={onEditMarquee}
        disabled={!canEditMarquee}
        aria-label={canEditMarquee ? "Edit weekly marquee message" : "Weekly marquee display"}
        data-tooltip={canEditMarquee ? `Click to edit weekly marquee — ${remainingLabel}` : undefined}
      >
        <div className="retro-marquee-track">
          <span>{marqueeText}</span>
          <span aria-hidden="true">{marqueeText}</span>
        </div>
      </button>
    </div>
  );
}
