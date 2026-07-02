export type FormsPayoutMode = "assured" | "random_subset" | "overflow_only";

export type FormsProofMode = "external_proof";

export type FormsMountableConfig = {
  enabled: boolean;
  formUrl: string;
  canonicalFormUrl?: string;
  formId?: string;
  validatedAt?: string;
  payoutMode: FormsPayoutMode;
  proofMode: FormsProofMode;
  guaranteedSlots: string;
  randomWinnerCount: string;
  proofInstructions: string;
};
