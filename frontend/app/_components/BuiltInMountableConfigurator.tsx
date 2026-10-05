"use client";

import MountableConfigHeader from "@/app/_components/MountableConfigHeader";
import type { LockMountableRule } from "@/app/_types/lockMountable";

type ValidationState = "idle" | "valid" | "invalid" | "validating";

type LockConfiguratorProps = {
  errorMessage?: string;
  fbars: string;
  isFocused: boolean;
  onFbarsChange: (value: string) => void;
  onFocusChange: (focused: boolean) => void;
  onRuleChange: (rule: LockMountableRule) => void;
  rule: LockMountableRule;
  validationState: ValidationState;
};

export function LockMountableConfigurator({
  errorMessage = "",
  fbars,
  isFocused,
  onFbarsChange,
  onFocusChange,
  onRuleChange,
  rule,
  validationState,
}: LockConfiguratorProps) {
  const principles: Array<{ rule: LockMountableRule; label: string }> = [
    { rule: "block_below", label: "Block participants with fewer FBARS than the parameter below" },
    { rule: "block_at_or_above", label: "Block participants with the parameter FBARS or more" },
  ];

  return (
    <div className="create-info-constraints-copy">
      <div className="create-info-forms-config create-info-forms-config-tight">
        <MountableConfigHeader
          kind="lock"
          name="Lock"
          description="Restrict participation using a creator-defined FBARS threshold. Participants with 5x your current FBARS can override it."
        />
        <div className="create-mountable-principles">
          <p className="create-review-section-label text-gray-900">Principles:</p>
          {principles.map((principle) => (
            <label className="create-mountable-principle create-mountable-principle-radio" key={principle.rule}>
              <input
                type="radio"
                name="lock-principle"
                checked={rule === principle.rule}
                onChange={() => onRuleChange(principle.rule)}
              />
              <span>{principle.label}</span>
            </label>
          ))}
        </div>
        <div className="create-mountable-params">
          <div className="create-mountable-params-heading">
            <p className="create-review-section-label text-gray-900">Params:</p>
            {errorMessage ? <p className="create-info-forms-inline-error">{errorMessage}</p> : null}
          </div>
          <div className="create-info-ticket-input-wrap">
            <input
              type="text"
              inputMode="numeric"
              value={fbars}
              onChange={(event) => onFbarsChange(event.target.value)}
              onFocus={() => {
                if (validationState === "idle") onFocusChange(true);
              }}
              onBlur={() => onFocusChange(false)}
              placeholder="0"
              className={`create-info-ticket-input create-info-ticket-input-with-suffix ${validationState === "invalid" ? "create-info-ticket-input-invalid" : validationState === "valid" ? "create-info-ticket-input-valid" : isFocused ? "create-info-ticket-input-focused" : ""}`.trim()}
              aria-label="Lock FBARS threshold"
            />
            <span className="create-info-ticket-input-suffix">FBARS</span>
          </div>
        </div>
      </div>
    </div>
  );
}

type FormsConfiguratorProps = {
  errorMessage?: string;
  formLinks: string[];
  isFocused: boolean;
  onFocusChange: (focused: boolean) => void;
  onLinkChange: (index: number, value: string) => void;
  validationState: ValidationState;
};

export function FormsMountableConfigurator({
  errorMessage = "",
  formLinks,
  isFocused,
  onFocusChange,
  onLinkChange,
  validationState,
}: FormsConfiguratorProps) {
  return (
    <div className="create-info-constraints-copy">
      <div className="create-info-forms-config">
        <MountableConfigHeader
          kind="forms"
          name="Forms"
          description="Collect and validate responses through a mounted Google Form."
        />
        {errorMessage ? <p className="create-info-forms-inline-error mt-3">{errorMessage}</p> : null}
        <div className="create-mountable-principles">
          <p className="create-review-section-label text-gray-900">Principles:</p>
          <div className="create-mountable-principle create-mountable-principle-selected">
            <span className="font-semibold text-gray-900">Google Forms</span>
          </div>
        </div>
        <div className="create-mountable-params">
          <p className="create-review-section-label text-gray-900">Params:</p>
          {formLinks.map((value, index) => (
            <div key={`forms-link-${index}`} className="create-info-forms-row">
              <input
                type="text"
                value={value}
                onChange={(event) => onLinkChange(index, event.target.value)}
                onFocus={() => {
                  if (validationState === "idle") onFocusChange(true);
                }}
                onBlur={() => onFocusChange(false)}
                placeholder="Paste Google Forms responder link"
                className={`create-info-ticket-input ${validationState === "invalid" ? "create-info-ticket-input-invalid" : validationState === "valid" ? "create-info-ticket-input-valid" : isFocused ? "create-info-ticket-input-focused" : ""}`.trim()}
                aria-label={`Forms link ${index + 1}`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
