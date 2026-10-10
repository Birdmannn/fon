import assert from "node:assert/strict";
import test from "node:test";
import { buildMountableSetupSequence, type MountableSetupStep } from "../app/_lib/mountableSetupSequence.ts";

const selected: MountableSetupStep[] = [
  { key: "app:z", label: "Zebra", mode: "mountables-apps", appId: "z" },
  { key: "lock", label: "Lock", mode: "mountables-lock" },
  { key: "app:a", label: "Alpha", mode: "mountables-apps", appId: "a" },
  { key: "forms", label: "Forms", mode: "mountables-forms" },
];

test("implicit approval stays last after built-ins and alphabetically sorted apps", () => {
  const sequence = buildMountableSetupSequence(selected, true);
  assert.deepEqual(sequence.map((step) => step.key), ["app:a", "forms", "lock", "app:z", "approval"]);
  assert.equal(sequence.at(-1)?.mode, "mountables-approval");
  assert.equal(sequence[0].appId, "a");
  assert.equal(selected[0].key, "app:z");
});

test("approval alone needs no explicitly selected mountable", () => {
  assert.deepEqual(buildMountableSetupSequence([], true).map((step) => step.key), ["approval"]);
});

test("removing approval removes its step and keeps ordinary setup order", () => {
  assert.deepEqual(buildMountableSetupSequence(selected, false).map((step) => step.key), ["app:a", "forms", "lock", "app:z"]);
  assert.deepEqual(buildMountableSetupSequence([], false), []);
});
