import { CampaignType } from "./contract.ts";

export function areRequiredPrinciplesSatisfied(
  selectedPrinciples: Array<{ principleId: string; required?: boolean }>,
  principleStates: Array<{ principleId: string; fulfilled: boolean }>,
) {
  const requiredIds = selectedPrinciples
    .filter((principle) => principle.required !== false)
    .map((principle) => principle.principleId);
  const statesById = new Map(principleStates.map((state) => [state.principleId, state.fulfilled]));
  return requiredIds.every((principleId) => statesById.get(principleId) === true);
}

/** Only configured participation and raffle entry require parent clearance. */
export function requiresParentParticipation(input: {
  campaignType?: unknown; participantKind?: unknown; mountableType?: unknown;
}) {
  return input.participantKind === "raffle_ticket" || input.participantKind === "forms_claim"
    || input.mountableType === "forms" || input.mountableType === "app" || input.participantKind === "app_update"
    || ((Number(input.campaignType) === CampaignType.Raffle || Number(input.campaignType) === CampaignType.RecurringRaffle)
      && !input.participantKind && !input.mountableType);
}

export function hasRequiredBaseParticipation(campaignType: unknown, rows: Array<{
  participantKind?: unknown; mountableType?: unknown; status?: unknown;
}>) {
  // Non-raffles have no implicit activity requirement beyond configured criteria.
  if (Number(campaignType) !== CampaignType.Raffle && Number(campaignType) !== CampaignType.RecurringRaffle) return true;
  return rows.some(row => row.status === "verified" && (row.participantKind === "raffle_ticket"
    || (!row.participantKind && !row.mountableType)));
}

export function isCanonicalParticipantVerified(input: {
  baseParticipationSatisfied: boolean;
  formsSatisfied: boolean;
  appPrinciplesSatisfied: boolean;
  lockSatisfied?: boolean;
  signableSatisfied?: boolean;
}) {
  return input.baseParticipationSatisfied && input.formsSatisfied && input.appPrinciplesSatisfied
    && input.lockSatisfied !== false && input.signableSatisfied !== false;
}

export function isMountedAppPollingEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

export function isMountedAppPollDue(input: {
  force?: boolean;
  lastPollAt?: string | null;
  pollIntervalSeconds?: number | null;
  now: Date;
}) {
  if (input.force) {
    return true;
  }
  if (!input.lastPollAt) {
    return true;
  }
  const lastPollTime = new Date(input.lastPollAt).getTime();
  if (!Number.isFinite(lastPollTime)) {
    return true;
  }
  return input.now.getTime() - lastPollTime >= (input.pollIntervalSeconds ?? 60) * 1000;
}

export function mountedAppWindowState(input: {
  startsAt?: string | null;
  endsAt?: string | null;
  at: Date;
}) {
  const startsAtMs = new Date(input.startsAt ?? "").getTime();
  const endsAtMs = new Date(input.endsAt ?? "").getTime();
  if (!Number.isFinite(startsAtMs) || !Number.isFinite(endsAtMs) || endsAtMs <= startsAtMs) {
    return "invalid" as const;
  }
  if (input.at.getTime() < startsAtMs) {
    return "pending" as const;
  }
  if (input.at.getTime() >= endsAtMs) {
    return "expired" as const;
  }
  return "active" as const;
}
