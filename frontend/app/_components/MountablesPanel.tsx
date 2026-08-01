"use client";

import { useEffect, useState } from "react";

const MOUNTABLES_PLACEHOLDER_MESSAGE = "Raffle · Forms · Locks · Public Payment Streaming ·   ";

function buildMarqueeCopy(message: string, ownerLabel?: string | null) {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return MOUNTABLES_PLACEHOLDER_MESSAGE;
  }

  return `${ownerLabel ? `${ownerLabel}: ` : ""}${trimmedMessage} ·   `;
}

export default function MountablesPanel() {
  const [marqueeCopy, setMarqueeCopy] = useState(MOUNTABLES_PLACEHOLDER_MESSAGE);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/user-profiles?marquee=1", {
          cache: "no-store",
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || cancelled) {
          return;
        }

        const ownerLabel = typeof payload?.activeWeeklyMarqueeOwner?.displayName === "string" && payload.activeWeeklyMarqueeOwner.displayName.trim().length > 0
          ? payload.activeWeeklyMarqueeOwner.displayName.trim()
          : typeof payload?.activeWeeklyMarqueeOwner?.handle === "string"
            ? payload.activeWeeklyMarqueeOwner.handle
            : null;
        const nextCopy = typeof payload?.activeWeeklyMarqueeMessage === "string"
          ? buildMarqueeCopy(payload.activeWeeklyMarqueeMessage, ownerLabel)
          : MOUNTABLES_PLACEHOLDER_MESSAGE;
        setMarqueeCopy(nextCopy || MOUNTABLES_PLACEHOLDER_MESSAGE);
      } catch {
        if (!cancelled) {
          setMarqueeCopy(MOUNTABLES_PLACEHOLDER_MESSAGE);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const marqueeText = `${marqueeCopy}${marqueeCopy}${marqueeCopy}`;

  return (
    <div className="retro-mountables-shell" aria-label="Mountables display">
      <div className="retro-marquee-track">
        <span>{marqueeText}</span>
        <span aria-hidden="true">{marqueeText}</span>
      </div>
    </div>
  );
}
