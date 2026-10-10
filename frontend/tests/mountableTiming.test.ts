import assert from "node:assert/strict";
import test from "node:test";

import { deriveMountableWindow, mountableWindowDurationSeconds } from "../lib/mountableTiming.ts";

test("derives mounted-app window from a chain millisecond timestamp string", () => {
  const window = deriveMountableWindow({
    baseTimestamp: "1791304622369",
    taskStartDelayHours: "0.1",
    taskDurationHours: "24",
  });

  assert.equal(window.startsAt, "2026-10-06T16:43:02.369Z");
  assert.equal(window.endsAt, "2026-10-07T16:43:02.369Z");
  assert.equal(mountableWindowDurationSeconds(window.startsAt, window.endsAt), 86400);
});

test("still accepts ISO timestamps", () => {
  const window = deriveMountableWindow({ baseTimestamp: "2026-10-06T16:37:02.369Z", taskDurationHours: "1" });
  assert.equal(window.startsAt, "2026-10-06T16:37:02.369Z");
  assert.equal(window.endsAt, "2026-10-06T17:37:02.369Z");
});
