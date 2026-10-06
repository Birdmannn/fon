"use client";

import Image from "next/image";
import { X } from "lucide-react";

import type { CampaignAttachment } from "@/app/_types/campaignAttachments";

type CampaignAttachmentGridProps = {
  attachments: CampaignAttachment[];
  editable?: boolean;
  onRemove?: (attachment: CampaignAttachment) => void;
};

export default function CampaignAttachmentGrid({ attachments, editable = false, onRemove }: CampaignAttachmentGridProps) {
  if (attachments.length === 0) return null;

  const visible = attachments.slice(0, 4);
  const remaining = Math.max(0, attachments.length - visible.length);

  return (
    <div className={`campaign-attachment-grid campaign-attachment-grid-${Math.min(visible.length, 4)}`}>
      {visible.map((attachment, index) => (
        <div className="campaign-attachment-tile" key={attachment.id}>
          <Image
            src={`/api/campaign-attachments/${encodeURIComponent(attachment.id)}`}
            alt={attachment.name || `Freight attachment ${index + 1}`}
            fill
            sizes="(max-width: 639px) 50vw, 24rem"
            unoptimized
          />
          {editable ? (
            <button
              type="button"
              className="campaign-attachment-remove"
              onClick={() => onRemove?.(attachment)}
              aria-label={`Remove ${attachment.name || `attachment ${index + 1}`}`}
              title="Remove photo"
            >
              <X size={16} strokeWidth={2.5} aria-hidden="true" />
            </button>
          ) : null}
          {index === 3 && remaining > 0 ? (
            <span className="campaign-attachment-overflow" aria-label={`${remaining} more photos`}>+{remaining}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
