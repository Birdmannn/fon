"use client";

import Link from "next/link";

import ThreeDotLoader from "@/app/_components/ThreeDotLoader";
import type { ProfileFreightInteractionKind, ProfileFreightRow } from "@/app/_types/profileTabs";

const INTERACTION_LABELS: Record<ProfileFreightInteractionKind, string> = {
  commented: "Commented",
  created: "Created",
  participated: "Participated",
  rewarded: "Rewarded",
};

function formatInteractionDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

type ProfileFreightsSectionProps = {
  error: string;
  loading: boolean;
  rows: ProfileFreightRow[];
};

export default function ProfileFreightsSection({ error, loading, rows }: ProfileFreightsSectionProps) {
  return (
    <section className="profile-tab-panel" aria-labelledby="profile-freights-title" role="tabpanel">
      <div className="profile-tab-panel-header">
        <h2 id="profile-freights-title" className="profile-tab-panel-title">Freights</h2>
        <p className="profile-tab-panel-copy">Latest freight interactions, one row per freight.</p>
      </div>

      {loading ? (
        <div className="profile-tab-state profile-tab-state-loading">
          <ThreeDotLoader label="Loading freights" inline />
        </div>
      ) : error ? (
        <p className="profile-tab-state profile-tab-state-error">{error}</p>
      ) : rows.length === 0 ? (
        <p className="profile-tab-state profile-tab-state-empty">No freight activity yet.</p>
      ) : (
        <div className="profile-freights-list">
          {rows.map((row) => (
            <Link
              key={row.campaignId}
              href={row.href}
              className={`profile-freight-row ${row.strongestInteraction === "rewarded" ? "profile-freight-row-rewarded" : ""}`.trim()}
            >
              <div className="profile-freight-row-main">
                <div className="profile-freight-row-heading">
                  <h3 className="profile-freight-title">{row.title}</h3>
                  <span className={`profile-freight-badge profile-freight-badge-${row.strongestInteraction}`.trim()}>
                    {INTERACTION_LABELS[row.strongestInteraction]}
                  </span>
                </div>
                <div className="profile-freight-meta-row">
                  <span className="profile-freight-date">Interacted {formatInteractionDate(row.latestInteractionAt)}</span>
                  <span className="profile-freight-creator">by {row.creatorHandle}</span>
                </div>
                <div className="profile-freight-kinds-row" aria-label="Freight interaction kinds">
                  {row.interactionKinds.map((kind) => (
                    <span key={`${row.campaignId}-${kind}`} className="profile-freight-kind-pill">
                      {INTERACTION_LABELS[kind]}
                    </span>
                  ))}
                </div>
              </div>
              <span className="profile-freight-row-arrow" aria-hidden="true">→</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
