import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCreatorWithdrawableSupport,
  calculateRaffleRewardPool,
  calculateRaffleSupportContribution,
  raffleSupportPercentToBasisPoints,
} from "../lib/raffleSupportPool.ts";

test("raffle support percentage is normalized to on-chain basis points", () => {
  assert.equal(raffleSupportPercentToBasisPoints(25n), 2_500n);
});

test("raffle reward pool combines ticket sales with the selected support share", () => {
  assert.equal(calculateRaffleSupportContribution(200n, 2_500n), 50n);
  assert.equal(calculateRaffleRewardPool({
    ticketPrice: 100n,
    ticketSalesTotal: 1_000n,
    creatorSupportTotal: 200n,
    supportPoolBps: 2_500n,
  }), 1_050n);
});

test("support left after raffle settlement remains creator-withdrawable", () => {
  assert.equal(calculateCreatorWithdrawableSupport({
    currentDeposits: 150n,
    ticketSalesTotal: 0n,
    creatorSupportTotal: 150n,
  }), 150n);
});
