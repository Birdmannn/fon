"use client";

import ThreeDotLoader from "@/app/_components/ThreeDotLoader";
import type { ProfileTransactionRow, ProfileTransactionsCoverage } from "@/app/_types/profileTabs";

const KIND_LABELS: Record<ProfileTransactionRow["kind"], string> = {
  wallet_seed: "Wallet seed",
  freight_create: "Freight create",
  campaign_activate: "Activation",
  campaign_participation: "Participation",
  campaign_deposit: "Deposit",
  campaign_settlement: "Settlement",
  campaign_reward: "Reward received",
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatUsdDelta(value: number | null) {
  if (value === null) {
    return null;
  }

  const sign = value >= 0 ? "+" : "-";
  const absolute = Math.abs(value);
  const whole = (absolute / 100).toFixed(2);
  return `${sign}$${whole} ADSF`;
}

function formatFbarsDelta(value: number | null) {
  if (value === null) {
    return null;
  }

  return `${value >= 0 ? "+" : ""}${value} FBARS`;
}

function formatNetDelta(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const bigintValue = BigInt(value);
    const sign = bigintValue > 0n ? "+" : bigintValue < 0n ? "-" : "";
    const absolute = bigintValue < 0n ? -bigintValue : bigintValue;
    const whole = absolute / 100_000_000n;
    const decimals = (absolute % 100_000_000n).toString().padStart(8, "0").slice(0, 2);
    return `${sign}${whole.toString()}.${decimals} CKB`;
  } catch {
    return null;
  }
}

type ProfileTransactionsSectionProps = {
  coverage: ProfileTransactionsCoverage;
  error: string;
  loading: boolean;
  rows: ProfileTransactionRow[];
};

export default function ProfileTransactionsSection({ coverage, error, loading, rows }: ProfileTransactionsSectionProps) {
  return (
    <section className="profile-tab-panel" aria-labelledby="profile-transactions-title" role="tabpanel">
      <div className="profile-tab-panel-header">
        <h2 id="profile-transactions-title" className="profile-tab-panel-title">Transactions</h2>
        <p className="profile-tab-panel-copy">Latest public freight transactions and related balance deltas.</p>
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
      ) : rows.length === 0 ? (
        <p className="profile-tab-state profile-tab-state-empty">No transactions yet.</p>
      ) : (
        <div className="profile-transactions-list">
          {rows.map((row) => {
            const usdDelta = formatUsdDelta(row.adsfUsdCentsDelta);
            const fbarsDelta = formatFbarsDelta(row.fbarsDelta);
            const netDelta = formatNetDelta(row.onchainNetDeltaShannons);
            const explorerHref = row.txHash ? `https://pudge.explorer.nervos.org/transaction/${row.txHash}` : null;

            return (
              <article key={row.id} className="profile-transaction-row">
                <div className="profile-transaction-row-main">
                  <div className="profile-transaction-heading-row">
                    <h3 className="profile-transaction-title">{row.summary}</h3>
                    <span className="profile-transaction-kind">{KIND_LABELS[row.kind]}</span>
                  </div>
                  <div className="profile-transaction-meta-row">
                    <span className="profile-transaction-time">{formatDateTime(row.occurredAt)}</span>
                    <span className="profile-transaction-channel">{row.channel}</span>
                    <span className="profile-transaction-role">{row.role}</span>
                  </div>
                  <div className="profile-transaction-context-row">
                    {row.campaignTitle ? <span className="profile-transaction-context">{row.campaignTitle}</span> : null}
                    {row.amountLabel ? <span className="profile-transaction-context">{row.amountLabel}</span> : null}
                  </div>
                  <div className="profile-transaction-deltas-row">
                    {netDelta ? <span className="profile-transaction-delta-pill">Net {netDelta}</span> : null}
                    {usdDelta ? <span className="profile-transaction-delta-pill">{usdDelta}</span> : null}
                    {fbarsDelta ? <span className="profile-transaction-delta-pill">{fbarsDelta}</span> : null}
                  </div>
                  {explorerHref ? (
                    <a
                      href={explorerHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="profile-transaction-link"
                    >
                      {row.txHash}
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
