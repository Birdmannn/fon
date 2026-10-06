"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { CampaignAttachment } from "@/app/_types/campaignAttachments";

type CampaignImageViewerProps = {
  attachments: CampaignAttachment[];
  initialIndex: number;
  onClose: () => void;
};

export default function CampaignImageViewer({ attachments, initialIndex, onClose }: CampaignImageViewerProps) {
  const [index, setIndex] = useState(initialIndex);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const attachment = attachments[index] ?? attachments[0];

  const move = (direction: number) => {
    setIndex((current) => (current + direction + attachments.length) % attachments.length);
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";

    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  if (!attachment) return null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="campaign-image-viewer"
      aria-label="Freight image viewer"
      onCancel={onClose}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          move(event.key === "ArrowLeft" ? -1 : 1);
        }
      }}
    >
      <button type="button" className="campaign-image-viewer-close" aria-label="Close image viewer" onClick={onClose} autoFocus>
        <X size={24} aria-hidden="true" />
      </button>
      <div
        className="campaign-image-viewer-stage"
        onTouchStart={(event) => {
          const touch = event.touches[0];
          touchStart.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
        }}
        onTouchMove={(event) => {
          if (event.touches.length !== 1) touchStart.current = null;
        }}
        onTouchCancel={() => { touchStart.current = null; }}
        onTouchEnd={(event) => {
          const start = touchStart.current;
          touchStart.current = null;
          const touch = event.changedTouches[0];
          if (!start || !touch) return;
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && attachments.length > 1) {
            move(dx < 0 ? 1 : -1);
          }
        }}
      >
        <Image
          key={attachment.id}
          src={`/api/campaign-attachments/${encodeURIComponent(attachment.id)}`}
          alt={attachment.name || `Freight image ${index + 1}`}
          fill
          sizes="100vw"
          unoptimized
          draggable={false}
          loading="eager"
        />
      </div>
      {attachments.length > 1 ? (
        <>
          <button type="button" className="campaign-image-viewer-previous" aria-label="Previous image" onClick={() => move(-1)}>
            <ChevronLeft size={28} aria-hidden="true" />
          </button>
          <button type="button" className="campaign-image-viewer-next" aria-label="Next image" onClick={() => move(1)}>
            <ChevronRight size={28} aria-hidden="true" />
          </button>
        </>
      ) : null}
      <p className="campaign-image-viewer-counter" aria-live="polite" aria-atomic="true">
        {index + 1} / {attachments.length}
      </p>
    </dialog>,
    document.body,
  );
}
