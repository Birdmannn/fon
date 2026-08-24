const MS_PER_HOUR = 60 * 60 * 1000;

function normalizeIsoTimestamp(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString();
}

function parseDurationHours(value: string | null | undefined) {
  const parsed = Number.parseFloat((value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export function deriveMountableWindow(args: {
  startsAt?: string | null;
  endsAt?: string | null;
  taskStartDelayHours?: string | null;
  taskDurationHours?: string | null;
  baseTimestamp?: string | number | Date | null;
}) {
  const explicitStartsAt = normalizeIsoTimestamp(args.startsAt);
  const explicitEndsAt = normalizeIsoTimestamp(args.endsAt);
  if (explicitStartsAt || explicitEndsAt) {
    return {
      startsAt: explicitStartsAt,
      endsAt: explicitEndsAt,
    };
  }

  const delayHours = parseDurationHours(args.taskStartDelayHours) ?? 0;
  const durationHours = parseDurationHours(args.taskDurationHours) ?? 0;

  const baseCandidate = args.baseTimestamp;
  const baseDate = baseCandidate instanceof Date
    ? baseCandidate
    : baseCandidate === null || baseCandidate === undefined
      ? null
      : new Date(baseCandidate);

  if (!baseDate || Number.isNaN(baseDate.getTime())) {
    return {
      startsAt: "",
      endsAt: "",
    };
  }

  const startsAt = new Date(baseDate.getTime() + delayHours * MS_PER_HOUR);
  const endsAt = new Date(startsAt.getTime() + durationHours * MS_PER_HOUR);

  return {
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  };
}
