import assert from "node:assert/strict";
import test from "node:test";

import { nextRecurringWinnerCount, recurringRafflePhaseEndsAt } from "../lib/recurringRaffle.ts";

test("recurring winner reduction uses ceiling and never drops below one", () => {
  assert.equal(nextRecurringWinnerCount(10n, 2_500n), 8n);
  assert.equal(nextRecurringWinnerCount(3n, 5_000n), 2n);
  assert.equal(nextRecurringWinnerCount(2n, 5_000n), 1n);
  assert.equal(nextRecurringWinnerCount(1n, 5_000n), 1n);
});

test("sleep begins after the round and uses millisecond chain timestamps", () => {
  assert.deepEqual(recurringRafflePhaseEndsAt({
    roundStartedAt: 1_000n,
    roundDurationSecs: 60n,
    sleepDurationSecs: 30n,
  }), {
    drawAt: 61_000n,
    sleepEndsAt: 91_000n,
  });
});
