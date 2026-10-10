import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { claimedGiftAmount } = jiti("../lib/giftClaimCredit.ts");
const wallet = new Uint8Array(32).fill(1);
const hash = `0x${"01".repeat(32)}`;
const before = { creator: wallet, open: true, slots: [{ claimant: new Uint8Array(32), amount: 1000n, claimed: false }] };
const after = { ...before, slots: [{ claimant: wallet, amount: 1000n, claimed: true }] };

test("gift credit uses the newly claimed allocation, excluding wallet-funded capacity top-ups", () => {
  assert.equal(claimedGiftAmount(before, after, hash), "1000");
});

test("gift credit rejects unclaimed, repeated, wrong-wallet and changed-amount claims", () => {
  assert.throws(() => claimedGiftAmount(before, before, hash));
  assert.throws(() => claimedGiftAmount(after, after, hash));
  assert.throws(() => claimedGiftAmount(before, after, `0x${"02".repeat(32)}`));
  assert.throws(() => claimedGiftAmount(before, { ...after, slots: [{ ...after.slots[0], amount: 2000n }] }, hash));
});
