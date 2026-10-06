const BASIS_POINTS_PER_PERCENT = 100n;
const FULL_PERCENT_BASIS_POINTS = 10_000n;

export function raffleSupportPercentToBasisPoints(percent: bigint) {
  return percent * BASIS_POINTS_PER_PERCENT;
}

export function calculateRaffleSupportContribution(creatorSupportTotal: bigint, supportPoolBps: bigint) {
  if (creatorSupportTotal <= 0n || supportPoolBps <= 0n) return 0n;
  return (creatorSupportTotal * supportPoolBps) / FULL_PERCENT_BASIS_POINTS;
}

export function calculateRaffleRewardPool({
  ticketPrice,
  ticketSalesTotal,
  creatorSupportTotal,
  supportPoolBps,
}: {
  ticketPrice: bigint;
  ticketSalesTotal: bigint;
  creatorSupportTotal: bigint;
  supportPoolBps: bigint;
}) {
  const ticketPool = ticketPrice === 0n ? 0n : ticketSalesTotal;
  return ticketPool + calculateRaffleSupportContribution(creatorSupportTotal, supportPoolBps);
}

export function calculateCreatorWithdrawableSupport({
  currentDeposits,
  ticketSalesTotal,
  creatorSupportTotal,
}: {
  currentDeposits: bigint;
  ticketSalesTotal: bigint;
  creatorSupportTotal: bigint;
}) {
  if (currentDeposits <= 0n || ticketSalesTotal !== 0n || creatorSupportTotal !== currentDeposits) return 0n;
  return creatorSupportTotal;
}
