"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export type CampaignThreadRole = "parent" | "child";

export default function CampaignThreadConnector({ role = "parent", directChildCount, onOpenOptions, onOpenTree, settlementAction, nodeTargetId }: { role?: CampaignThreadRole; directChildCount: number | null; onOpenOptions: () => void; onOpenTree: () => void; settlementAction?: ReactNode; nodeTargetId?: string | null }) {
  return (
    <div className="campaign-thread-controls">
      <div className={`campaign-thread-connector campaign-thread-connector-${role}`}>
        <span className="campaign-thread-connector-line" aria-hidden="true" />
        <span className="campaign-thread-connector-node-row">
          {directChildCount !== null && directChildCount > 1 ? (
            <button type="button" className="campaign-thread-connector-node campaign-thread-connector-node-link"
              onClick={onOpenTree} aria-label="View freight tree" aria-haspopup="dialog" data-tooltip="Freight is a parent" />
          ) : nodeTargetId ? (
            <Link className="campaign-thread-connector-node campaign-thread-connector-node-link"
              href={`/freight/${encodeURIComponent(nodeTargetId)}`}
              aria-label={role === "child" ? "Go to parent freight" : "Go to child freight"}
              data-tooltip={role === "child" ? "Freight is a child" : "Freight is a parent"} />
          ) : (
            <span className="campaign-thread-connector-node" data-tooltip={role === "child" ? "Freight is a child" : "Freight is a parent"} />
          )}
          {directChildCount !== null ? (
            <span className="campaign-thread-connector-count" aria-label={`${directChildCount} direct children`}>{directChildCount}</span>
          ) : null}
        </span>
      </div>
      <div className="campaign-thread-actions">
        {settlementAction}
        <div className="campaign-thread-more-wrap">
          <button type="button" className="campaign-thread-more-button" aria-label="More freight options"
            aria-haspopup="dialog" data-tooltip="More options" onClick={onOpenOptions}>
            <Ellipsis size={16} strokeWidth={1} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
