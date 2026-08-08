"use client";

import { LockKeyhole, Scroll } from "lucide-react";

export type CampaignMountableItem = {
  description: string;
  href?: string;
  icon?: "forms" | "lock";
  key: string;
  metadata?: string[];
  proofInstructions?: string;
  title: string;
};

type CampaignMountablesPanelProps = {
  emptyMessage?: string;
  items: CampaignMountableItem[];
  title?: string;
};

export default function CampaignMountablesPanel({
  emptyMessage = "No mountables yet.",
  items,
  title = "Mountables",
}: CampaignMountablesPanelProps) {
  return (
    <div className="campaign-detail-card-shell campaign-detail-mountables-card">
      <div className="campaign-detail-comments-header">
        <h2 className="campaign-detail-comments-title">{title}</h2>
        <span className="campaign-detail-comments-count">{items.length}</span>
      </div>
      {items.length > 0 ? (
        <div className="campaign-detail-mountables-list">
          {items.map((item) => (
            <article key={item.key} className="campaign-detail-mountable-item">
              <div className="campaign-detail-mountable-heading-row">
                <span className="campaign-card-mounted-icon" title={`${item.title} mounted`} aria-label={`${item.title} mounted`}>
                  {item.icon === "lock" ? (
                    <LockKeyhole size={22} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <Scroll size={22} strokeWidth={2} aria-hidden="true" />
                  )}
                </span>
                <div className="campaign-detail-mountable-copy">
                  <div className="campaign-detail-mountable-title-row">
                    <h3 className="campaign-detail-mountable-title">{item.title}</h3>
                    {item.href ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="campaign-detail-mountable-link"
                      >
                        Open
                      </a>
                    ) : null}
                  </div>
                  <p className="campaign-detail-mountable-summary">{item.description}</p>
                  {item.metadata?.length ? (
                    <div className="campaign-detail-mountable-metadata-row">
                      {item.metadata.map((value) => (
                        <span key={value} className="campaign-detail-mountable-metadata">{value}</span>
                      ))}
                    </div>
                  ) : null}
                  {item.proofInstructions ? (
                    <p className="campaign-detail-mountable-proof">{item.proofInstructions}</p>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="campaign-detail-comments-empty">{emptyMessage}</p>
      )}
    </div>
  );
}
