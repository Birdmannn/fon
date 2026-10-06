export function nextRecurringWinnerCount(current: bigint, reductionBps: bigint) {
  if (current <= 0n || reductionBps <= 0n || reductionBps > 10_000n) {
    throw new Error("Invalid recurring raffle winner reduction");
  }
  const numerator = current * (10_000n - reductionBps);
  const reduced = (numerator + 9_999n) / 10_000n;
  return reduced > 0n ? reduced : 1n;
}

export function recurringRafflePhaseEndsAt(args: {
  roundStartedAt: bigint;
  roundDurationSecs: bigint;
  sleepDurationSecs: bigint;
}) {
  const drawAt = args.roundStartedAt + args.roundDurationSecs * 1_000n;
  return {
    drawAt,
    sleepEndsAt: drawAt + args.sleepDurationSecs * 1_000n,
  };
}
