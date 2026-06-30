import type { FormsMountableConfig, FormsPayoutMode, FormsProofMode } from "@/app/_types/formsMountable";

export const DEFAULT_FORMS_MOUNTABLE_CONFIG: FormsMountableConfig = {
  enabled: false,
  formUrl: "",
  payoutMode: "assured",
  proofMode: "external_proof",
  guaranteedSlots: "1",
  randomWinnerCount: "1",
  proofInstructions: "",
};

export function normalizeFormsPayoutMode(value: unknown): FormsPayoutMode {
  return value === "random_subset" || value === "overflow_only" || value === "assured"
    ? value
    : "assured";
}

export function normalizeFormsProofMode(value: unknown): FormsProofMode {
  return value === "external_proof" ? value : "external_proof";
}

export function normalizeFormsMountableConfig(value: Partial<FormsMountableConfig> | null | undefined): FormsMountableConfig {
  return {
    enabled: Boolean(value?.enabled),
    formUrl: typeof value?.formUrl === "string" ? value.formUrl : "",
    payoutMode: normalizeFormsPayoutMode(value?.payoutMode),
    proofMode: normalizeFormsProofMode(value?.proofMode),
    guaranteedSlots: typeof value?.guaranteedSlots === "string" ? value.guaranteedSlots : "1",
    randomWinnerCount: typeof value?.randomWinnerCount === "string" ? value.randomWinnerCount : "1",
    proofInstructions: typeof value?.proofInstructions === "string" ? value.proofInstructions : "",
  };
}

export function isFormsMountableEnabled(value: Partial<FormsMountableConfig> | null | undefined) {
  return Boolean(value?.enabled);
}

export function formsMountableSummary(config: FormsMountableConfig) {
  if (!config.enabled) {
    return "No forms mountable configured.";
  }

  if (config.payoutMode === "assured") {
    return `Forms • assured pay • ${config.guaranteedSlots} guaranteed slot(s)`;
  }

  if (config.payoutMode === "random_subset") {
    return `Forms • randomized pay • ${config.randomWinnerCount} random winner(s)`;
  }

  return `Forms • overflow randomization • ${config.guaranteedSlots} guaranteed slot(s), then ${config.randomWinnerCount} randomized winner(s)`;
}
