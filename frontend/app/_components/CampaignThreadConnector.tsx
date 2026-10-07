"use client";

import { Ellipsis } from "lucide-react";

export type CampaignThreadRole = "parent" | "child";

export default function CampaignThreadConnector({ role = "parent", directChildCount, onOpenOptions }: { role?: CampaignThreadRole; directChildCount: number | null; onOpenOptions: () => void }) {
  return (
    <div className="campaign-thread-controls">
      <div className={`campaign-thread-connector campaign-thread-connector-${role}`}>
        <span className="campaign-thread-connector-line" aria-hidden="true" />
        <span className="campaign-thread-connector-node-row">
          <span className="campaign-thread-connector-node" aria-hidden="true" />
          {directChildCount !== null ? (
            <span className="campaign-thread-connector-count" aria-label={`${directChildCount} direct children`}>{directChildCount}</span>
          ) : null}
        </span>
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
