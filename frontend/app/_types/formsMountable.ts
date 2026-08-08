export type FormsPayoutMode = "assured" | "random_subset" | "overflow_only";

export type FormsProofMode = "external_proof";
export type FormsVerificationMode = "google_forms_api";
export type FormsResponseAccessStatus = "pending" | "verified";

export type FormsMountableConfig = {
  enabled: boolean;
  formUrl: string;
  canonicalFormUrl?: string;
  formId?: string;
  validatedAt?: string;
  payoutMode: FormsPayoutMode;
  proofMode: FormsProofMode;
  verificationMode?: FormsVerificationMode;
  responseAccessEmail?: string;
  responseAccessStatus?: FormsResponseAccessStatus;
  responseAccessVerifiedAt?: string;
  guaranteedSlots: string;
  randomWinnerCount: string;
  proofInstructions: string;
};
