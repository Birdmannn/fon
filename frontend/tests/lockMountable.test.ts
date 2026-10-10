import assert from "node:assert/strict";
import test from "node:test";

import {
  canAccessLockMountable,
  lockMountableAccessMessage,
  normalizeLockMountableConfig,
} from "../app/_lib/lockMountable.ts";

test("block-below lock admits the threshold and blocks lower FBARS", () => {
  const lock = normalizeLockMountableConfig({ enabled: true, rule: "block_below", minimumFbars: "100" });

  assert.equal(canAccessLockMountable(lock, 99), false);
  assert.equal(canAccessLockMountable(lock, 100), true);
  assert.equal(canAccessLockMountable(lock, 101), true);
  assert.equal(lockMountableAccessMessage(lock), "This freight requires at least 100 FBARS");
});

test("block-at-or-above lock admits lower FBARS and blocks the threshold", () => {
  const lock = normalizeLockMountableConfig({ enabled: true, rule: "block_at_or_above", minimumFbars: "100" });

  assert.equal(canAccessLockMountable(lock, 99), true);
  assert.equal(canAccessLockMountable(lock, 100), false);
  assert.equal(canAccessLockMountable(lock, 101), false);
  assert.equal(lockMountableAccessMessage(lock), "This freight is limited to participants below 100 FBARS");
});

test("legacy locks default to the block-below principle", () => {
  const lock = normalizeLockMountableConfig({ enabled: true, minimumFbars: "5" });

  assert.equal(lock.rule, "block_below");
  assert.equal(canAccessLockMountable(lock, 4), false);
  assert.equal(canAccessLockMountable(lock, 5), true);
});

test("five times the creator's current FBARS overrides either lock rule", () => {
  const blockBelow = normalizeLockMountableConfig({ enabled: true, rule: "block_below", minimumFbars: "300" });
  const blockAtOrAbove = normalizeLockMountableConfig({ enabled: true, rule: "block_at_or_above", minimumFbars: "100" });

  assert.equal(canAccessLockMountable(blockBelow, 249, 50), false);
  assert.equal(canAccessLockMountable(blockBelow, 250, 50), true);
  assert.equal(canAccessLockMountable(blockAtOrAbove, 249, 50), false);
  assert.equal(canAccessLockMountable(blockAtOrAbove, 250, 50), true);
  assert.equal(lockMountableAccessMessage(blockAtOrAbove, 50), "This freight is limited to participants below 100 FBARS, or 250 FBARS to override");
});
