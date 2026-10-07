"use client";

import { Ellipsis } from "lucide-react";

export type CampaignThreadRole = "parent" | "child";

export default function CampaignThreadConnector({ role = "parent", onOpenOptions }: { role?: CampaignThreadRole; onOpenOptions: () => void }) {
  return (
    <div className="campaign-thread-controls">
      <div className={`campaign-thread-connector campaign-thread-connector-${role}`} aria-hidden="true">
        <span className="campaign-thread-connector-line" />
        <span className="campaign-thread-connector-node" />
      </div>
      <div className="campaign-thread-more-wrap">
        <button type="button" className="campaign-thread-more-button" aria-label="More freight options"
          aria-haspopup="dialog" data-tooltip="More options" onClick={onOpenOptions}>
          <Ellipsis size={16} strokeWidth={1} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
