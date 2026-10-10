import assert from "node:assert/strict";
import test from "node:test";

import {
  areRequiredPrinciplesSatisfied,
  isCanonicalParticipantVerified,
  isMountedAppPollDue,
  isMountedAppPollingEnabled,
  mountedAppWindowState,
} from "../lib/mountableAppRuntimeRules.ts";
import { resolveSelectedMountableAppPrinciples } from "../lib/fonMountablesSdk.ts";

test("optional principles do not block mounted-app satisfaction", () => {
  assert.equal(areRequiredPrinciplesSatisfied(
    [
      { principleId: "required", required: true },
      { principleId: "optional", required: false },
    ],
    [
      { principleId: "required", fulfilled: true },
      { principleId: "optional", fulfilled: false },
    ],
  ), true);
});

test("mounted-app event secrets are only active inside their freight window", () => {
  const window = {
    startsAt: "2026-09-29T12:00:00.000Z",
    endsAt: "2026-09-29T13:00:00.000Z",
  };
  assert.equal(mountedAppWindowState({ ...window, at: new Date("2026-09-29T11:59:59.000Z") }), "pending");
  assert.equal(mountedAppWindowState({ ...window, at: new Date("2026-09-29T12:30:00.000Z") }), "active");
  assert.equal(mountedAppWindowState({ ...window, at: new Date("2026-09-29T13:00:00.000Z") }), "expired");
});

test("missing or false required principles block satisfaction", () => {
  assert.equal(areRequiredPrinciplesSatisfied(
    [{ principleId: "required", required: true }],
    [],
  ), false);
  assert.equal(areRequiredPrinciplesSatisfied(
    [{ principleId: "required", required: true }],
    [{ principleId: "required", fulfilled: false }],
  ), false);
});

test("canonical verification requires base, forms, and app satisfaction", () => {
  assert.equal(isCanonicalParticipantVerified({
    baseParticipationSatisfied: true,
    formsSatisfied: true,
    appPrinciplesSatisfied: true,
  }), true);
  assert.equal(isCanonicalParticipantVerified({
    baseParticipationSatisfied: false,
    formsSatisfied: true,
    appPrinciplesSatisfied: true,
  }), false);
});

test("poll scheduling honors the configured interval", () => {
  const now = new Date("2026-09-29T12:01:00.000Z");
  assert.equal(isMountedAppPollDue({ now, lastPollAt: null, pollIntervalSeconds: 30 }), true);
  assert.equal(isMountedAppPollDue({ now, lastPollAt: "2026-09-29T12:00:45.000Z", pollIntervalSeconds: 30 }), false);
  assert.equal(isMountedAppPollDue({ now, lastPollAt: "2026-09-29T12:00:30.000Z", pollIntervalSeconds: 30 }), true);
  assert.equal(isMountedAppPollDue({ now, lastPollAt: "2026-09-29T12:00:59.000Z", pollIntervalSeconds: 300, force: true }), true);
});

test("mounted-app polling is opt-in and ignores non-true values", () => {
  assert.equal(isMountedAppPollingEnabled(undefined), false);
  assert.equal(isMountedAppPollingEnabled("false"), false);
  assert.equal(isMountedAppPollingEnabled("1"), false);
  assert.equal(isMountedAppPollingEnabled(" TRUE "), true);
});

test("creator principle parameters survive selection resolution", () => {
  const [selection] = resolveSelectedMountableAppPrinciples([
    {
      principleId: "exact-text",
      title: "Exact text",
      description: "",
      supportsTimestampQuery: false,
      paramsSchema: [{
        paramKey: "target-text",
        title: "Required text",
        description: "",
        valueType: "string",
        required: true,
      }],
      paramsDefaults: { "target-text": "default" },
      readableFormat: "Type exactly: {target-text}",
      exampleReadableText: "Type exactly: default",
    },
  ], [{ principleId: "exact-text", params: { "target-text": "creator-value" } }]);

  assert.equal(selection.params["target-text"], "creator-value");
  assert.equal(selection.displayLabel, "Type exactly: creator-value");
});
