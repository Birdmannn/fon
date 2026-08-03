"use client";

import { useCallback, useEffect, useState } from "react";

import { ccc } from "@ckb-ccc/connector-react";

const MOUNTABLES_PLACEHOLDER_MESSAGE = "Raffle · Forms · Locks · Public Payment Streaming ·   ";
const MAX_WEEKLY_MARQUEE_MESSAGE_LENGTH = 120;

type WeeklyMarqueeOwner = {
  address: string;
  displayName: string;
  handle: string;
};

function buildMarqueeCopy(message: string, ownerLabel?: string | null) {
  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    return MOUNTABLES_PLACEHOLDER_MESSAGE;
  }

  return `${ownerLabel ? `${ownerLabel}: ` : ""}${trimmedMessage} ·   `;
}

export default function MountablesPanel() {
  const signer = ccc.useSigner();
  const [marqueeCopy, setMarqueeCopy] = useState(MOUNTABLES_PLACEHOLDER_MESSAGE);
  const [marqueeDraft, setMarqueeDraft] = useState("");
  const [marqueeError, setMarqueeError] = useState("");
  const [isEditingMarquee, setIsEditingMarquee] = useState(false);
  const [isSavingMarquee, setIsSavingMarquee] = useState(false);
  const [canEditMarquee, setCanEditMarquee] = useState(false);
  const [activeWeeklyMarqueeOwner, setActiveWeeklyMarqueeOwner] = useState<WeeklyMarqueeOwner | null>(null);

  const loadMarquee = useCallback(async () => {
    const response = await fetch("/api/user-profiles?marquee=1", {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error ?? "Failed to load marquee message");
    }

    const ownerLabel = typeof payload?.activeWeeklyMarqueeOwner?.displayName === "string" && payload.activeWeeklyMarqueeOwner.displayName.trim().length > 0
      ? payload.activeWeeklyMarqueeOwner.displayName.trim()
      : typeof payload?.activeWeeklyMarqueeOwner?.handle === "string"
        ? payload.activeWeeklyMarqueeOwner.handle
        : null;
    const activeMessage = typeof payload?.activeWeeklyMarqueeMessage === "string"
      ? payload.activeWeeklyMarqueeMessage
      : "";

    setActiveWeeklyMarqueeOwner(payload?.activeWeeklyMarqueeOwner ?? null);
    setMarqueeCopy(activeMessage ? buildMarqueeCopy(activeMessage, ownerLabel) : MOUNTABLES_PLACEHOLDER_MESSAGE);
    setMarqueeDraft(activeMessage);
    return payload;
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const payload = await loadMarquee();
        if (cancelled || !signer) {
          return;
        }

        const address = await signer.getRecommendedAddress();
        if (!address) {
          return;
        }

        const normalizedAddress = address.trim().toLowerCase();
        const ownerAddress = typeof payload?.activeWeeklyMarqueeOwner?.address === "string"
          ? payload.activeWeeklyMarqueeOwner.address.trim().toLowerCase()
          : "";
        setCanEditMarquee(Boolean(ownerAddress) && ownerAddress === normalizedAddress);
      } catch {
        if (!cancelled) {
          setCanEditMarquee(false);
          setMarqueeCopy(MOUNTABLES_PLACEHOLDER_MESSAGE);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadMarquee, signer]);

  const handleMarqueeClick = useCallback(() => {
    if (!canEditMarquee || isSavingMarquee) {
      return;
    }

    setMarqueeError("");
    setIsEditingMarquee(true);
  }, [canEditMarquee, isSavingMarquee]);

  const handleMarqueeSave = useCallback(async () => {
    if (!signer) {
      setMarqueeError("Connect a wallet first");
      return;
    }

    try {
      setIsSavingMarquee(true);
      setMarqueeError("");

      const address = await signer.getRecommendedAddress();
      if (!address) {
        throw new Error("Unable to resolve wallet address");
      }

      const response = await fetch("/api/user-profiles", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address,
          weeklyMarqueeMessage: marqueeDraft.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to update weekly marquee message");
      }

      await loadMarquee();
      setIsEditingMarquee(false);
    } catch (error) {
      setMarqueeError(error instanceof Error ? error.message : "Failed to update weekly marquee message");
    } finally {
      setIsSavingMarquee(false);
    }
  }, [loadMarquee, marqueeDraft, signer]);

  const marqueeText = `${marqueeCopy}${marqueeCopy}${marqueeCopy}`;
  const editorLabel = activeWeeklyMarqueeOwner?.displayName?.trim() || activeWeeklyMarqueeOwner?.handle || "Weekly winner";

  return (
    <div className="retro-mountables-shell" aria-label="Mountables display">
      <button
        type="button"
        className={`retro-marquee-button ${canEditMarquee ? "retro-marquee-button-editable" : ""}`.trim()}
        onClick={handleMarqueeClick}
        disabled={!canEditMarquee}
        aria-label={canEditMarquee ? "Edit weekly marquee message" : "Weekly marquee display"}
        title={canEditMarquee ? "Click to edit weekly marquee" : undefined}
      >
        <div className="retro-marquee-track">
          <span>{marqueeText}</span>
          <span aria-hidden="true">{marqueeText}</span>
        </div>
      </button>

      {isEditingMarquee ? (
        <div className="retro-marquee-editor">
          <p className="retro-marquee-editor-label">Weekly marquee for {editorLabel}</p>
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
              disabled={isSavingMarquee}
            />
            <button
              type="button"
              className="retro-marquee-editor-action"
              onClick={() => void handleMarqueeSave()}
              disabled={isSavingMarquee}
            >
              {isSavingMarquee ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              className="retro-marquee-editor-action retro-marquee-editor-action-secondary"
              onClick={() => {
                setIsEditingMarquee(false);
                setMarqueeError("");
              }}
              disabled={isSavingMarquee}
            >
              Cancel
            </button>
          </div>
          {marqueeError ? <p className="retro-marquee-editor-error">{marqueeError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
