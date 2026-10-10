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

export function isCanonicalParticipantVerified(input: {
  baseParticipationSatisfied: boolean;
  formsSatisfied: boolean;
  appPrinciplesSatisfied: boolean;
}) {
  return input.baseParticipationSatisfied && input.formsSatisfied && input.appPrinciplesSatisfied;
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
