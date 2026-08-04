"use client";

import ThreeDotLoader from "@/app/_components/ThreeDotLoader";
import type { ProfileTransactionRow, ProfileTransactionsCoverage } from "@/app/_types/profileTabs";

function formatCompactDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function truncateTransactionHash(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 33) {
    return trimmed;
  }

  return `${trimmed.slice(0, 16)}…${trimmed.slice(-16)}`;
}

function formatUsdDelta(value: number | null) {
  if (value === null) {
    return null;
  }

  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const dollars = Math.floor(absolute) / 100;
  return `${sign}${dollars.toFixed(2)} USD`;
}

function formatFbarsDelta(value: number | null) {
  if (value === null) {
    return null;
  }

  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value)} FBARS`;
}

function getPrimaryAmount(row: ProfileTransactionRow) {
  const fbarsDelta = formatFbarsDelta(row.fbarsDelta);
  const ckbUsdDelta = formatUsdDelta(row.ckbUsdCentsDelta);
  const adsfUsdDelta = formatUsdDelta(row.adsfUsdCentsDelta);

  if (row.channel === "offchain") {
    return fbarsDelta ?? adsfUsdDelta ?? "0 FBARS";
  }

  return ckbUsdDelta ?? adsfUsdDelta ?? "$0.00";
}

function getAmountToneClass(value: string) {
  if (value.startsWith("+")) {
    return "profile-transaction-summary-amount-positive";
  }
  if (value.startsWith("-")) {
    return "profile-transaction-summary-amount-negative";
  }
  return "profile-transaction-summary-amount-neutral";
}

type ProfileTransactionsSectionProps = {
  coverage: ProfileTransactionsCoverage;
  error: string;
  hasLoaded: boolean;
  isRefreshing: boolean;
  loading: boolean;
  onRefresh: () => void;
  rows: ProfileTransactionRow[];
};

export default function ProfileTransactionsSection({ coverage, error, hasLoaded, isRefreshing, loading, onRefresh, rows }: ProfileTransactionsSectionProps) {
  return (
    <section className="profile-tab-panel" aria-labelledby="profile-tab-transactions" role="tabpanel">
      <div className="profile-tab-toolbar">
        <button
          type="button"
          className="profile-tab-refresh-button"
          onClick={onRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {!coverage.complete && coverage.notes.length > 0 ? (
        <div className="profile-transactions-coverage" role="note">
          {coverage.notes.map((note) => (
            <p key={note} className="profile-transactions-coverage-note">{note}</p>
          ))}
        </div>
      ) : null}

      {loading ? (
        <div className="profile-tab-state profile-tab-state-loading">
          <ThreeDotLoader label="Loading transactions" inline />
        </div>
      ) : error ? (
        <p className="profile-tab-state profile-tab-state-error">{error}</p>
      ) : !hasLoaded ? (
        <p className="profile-tab-state profile-tab-state-empty">Click refresh to load transactions.</p>
      ) : rows.length === 0 ? (
        <p className="profile-tab-state profile-tab-state-empty">No transactions yet.</p>
      ) : (
        <div className="profile-transactions-list">
          {rows.map((row) => {
            const explorerHref = row.txHash ? `https://pudge.explorer.nervos.org/transaction/${row.txHash}` : null;
            const primaryAmount = getPrimaryAmount(row);

            return (
              <article key={row.id} className="profile-transaction-row-simple">
                <span className="profile-transaction-row-simple-date">{formatCompactDate(row.occurredAt)}</span>
                {explorerHref ? (
                  <a
                    href={explorerHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="profile-transaction-row-simple-hash"
                  >
                    {truncateTransactionHash(row.txHash ?? "")}
                  </a>
                ) : (
                  <span className="profile-transaction-row-simple-hash">{row.summary}</span>
                )}
                <span className={`profile-transaction-row-simple-amount ${getAmountToneClass(primaryAmount)}`.trim()}>{primaryAmount}</span>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
