"use client";

import Link from "next/link";

import ThreeDotLoader from "@/app/_components/ThreeDotLoader";
import type { ProfileFreightRow } from "@/app/_types/profileTabs";

function formatCompactDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function truncateFreightTitle(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 10) {
    return trimmed;
  }

  return `${trimmed.slice(0, 10)}…`;
}

function getInlineFreightMeta(row: ProfileFreightRow) {
  return row.creatorHandle;
}

type ProfileFreightsSectionProps = {
  error: string;
  hasLoaded: boolean;
  isRefreshing: boolean;
  loading: boolean;
  rows: ProfileFreightRow[];
};

export default function ProfileFreightsSection({ error, hasLoaded, loading, rows }: ProfileFreightsSectionProps) {
  return (
    <section className="profile-tab-panel" aria-labelledby="profile-tab-freights" role="tabpanel">
      {loading ? (
        <div className="profile-tab-state profile-tab-state-loading">
          <ThreeDotLoader label="Loading freights" inline />
        </div>
      ) : error ? (
        <p className="profile-tab-state profile-tab-state-error">{error}</p>
      ) : !hasLoaded ? (
        <p className="profile-tab-state profile-tab-state-empty">Click refresh to load freights.</p>
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
              <span className="profile-freight-inline-date">{formatCompactDate(row.latestInteractionAt)}</span>
              <span className="profile-freight-inline-main">
                <span className={`profile-freight-inline-dot profile-freight-inline-dot-${row.strongestInteraction}`.trim()} aria-hidden="true" />
                <span className="profile-freight-inline-title">{truncateFreightTitle(row.title)}</span>
              </span>
              <span className="profile-freight-inline-amount">{getInlineFreightMeta(row)}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
