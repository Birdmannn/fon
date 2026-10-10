"use client";

import MountableConfigHeader from "@/app/_components/MountableConfigHeader";
import type { GiftApprovalMode } from "@/lib/giftDeliverables";
import type { RaffleApprovalStage } from "@/lib/raffleApproval";

export type RaffleApprovalSetup = {
  stage: RaffleApprovalStage;
  mode: GiftApprovalMode;
  threshold: string;
  approverCount: number;
  recurring: boolean;
  mounted: boolean;
};

export default function RaffleApprovalConfigurator({ config, onChange, errorMessage, onBack, busy }: {
  config: RaffleApprovalSetup;
  onChange: (config: RaffleApprovalSetup) => void;
  errorMessage: string;
  onBack: () => void;
  busy: boolean;
}) {
  const stages = [
    { stage: "on-commence" as const, title: "On Commencement:", description: config.recurring
      ? "Approve before the initial delay ends; later rounds are exempt."
      : "Approve before the start delay ends; otherwise, cancel only." },
    ...(!config.recurring ? [{ stage: "on-delivery" as const, title: "On delivery:", description: "All tagged users must approve before rewards are distributed." }] : []),
  ];
  return (
    <div className="create-info-constraints-copy">
      <div className="create-info-forms-config create-info-forms-config-tight">
        <MountableConfigHeader kind="signable" name="Approval" description="Choose when tagged approvals are required." />
        {stages.map(({ stage, title, description }) => (
          <section key={stage} className="create-mountable-principles">
            <p className="create-review-section-label text-gray-900">{title}</p>
            <p className="create-info-constraint-item text-gray-500">{description}</p>
          </section>
        ))}
        <div className="create-mountable-principles">
          <p className="create-review-section-label text-gray-900">Approval stage:</p>
          {stages.map(({ stage }) => (
            <label key={stage} className="create-mountable-principle create-mountable-principle-radio">
              <input type="radio" name="raffle-approval-stage" checked={config.stage === stage} onChange={() => onChange({ ...config, stage })} />
              <span>{stage === "on-commence" ? "On commencement" : "On delivery"}</span>
            </label>
          ))}
        </div>
        <div className="create-info-confirm-actions create-info-confirm-actions-tight">
          <button type="button" className="create-info-confirm-btn" onClick={onBack} disabled={busy}>Back</button>
        </div>
        {config.stage === "on-commence" ? (
          <div className="create-mountable-principles">
            <p className="create-review-section-label text-gray-900">Required approvals:</p>
            {(["all", "threshold"] as const).map((mode) => (
              <label key={mode} className="create-mountable-principle create-mountable-principle-radio">
                <input type="radio" name="raffle-approval-count" checked={config.mode === mode} onChange={() => onChange({ ...config, mode })} />
                <span>{mode === "all" ? "All tagged users" : "Approval threshold"}</span>
              </label>
            ))}
            {config.mode === "threshold" ? (
              <label className="create-review-arg-field">
                <span className="create-review-arg-label">Number of approvals (of {config.approverCount})</span>
                <input className="create-review-arg-input" type="number" min={1} max={config.approverCount} step={1} value={config.threshold} onChange={(event) => onChange({ ...config, threshold: event.target.value })} />
              </label>
            ) : null}
          </div>
        ) : null}
        {errorMessage ? <p className="create-info-forms-inline-error" role="alert">{errorMessage}</p> : null}
      </div>
    </div>
  );
}

export function RaffleApprovalActions({ onContinue, busy }: {
  onContinue: () => void;
  busy: boolean;
}) {
  return (
    <div className="create-info-confirm-actions create-info-confirm-actions-tight">
      <button type="button" className="create-info-confirm-btn create-info-confirm-btn-primary" onClick={onContinue} disabled={busy}>{busy ? "Hold..." : "Continue"}</button>
    </div>
  );
}
