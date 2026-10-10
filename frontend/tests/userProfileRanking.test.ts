import assert from "node:assert/strict";
import test from "node:test";

import { uniqueProfilesByAddress } from "../lib/userProfileRanking.ts";

test("rankings include one profile per normalized wallet address", () => {
  const profiles = [
    { address: "CKT1ABC", fbars: 5, updatedAt: new Date("2026-10-01T00:00:00Z") },
    { address: "ckt1def", fbars: 8, updatedAt: "2026-10-02T00:00:00Z" },
    { address: "ckt1abc", fbars: 3, updatedAt: new Date("2026-10-03T00:00:00Z") },
    { address: "  ", fbars: 99, updatedAt: "2026-10-04T00:00:00Z" },
  ];

  assert.deepEqual(uniqueProfilesByAddress(profiles), [profiles[2], profiles[1]]);
});

test("older duplicate profiles do not replace the latest wallet profile", () => {
  const profiles = [
    { address: "ckt1abc", fbars: 3, updatedAt: "2026-10-03T00:00:00Z" },
    { address: "CKT1ABC", fbars: 5, updatedAt: "2026-10-01T00:00:00Z" },
  ];

  assert.deepEqual(uniqueProfilesByAddress(profiles), [profiles[0]]);
});
