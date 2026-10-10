import assert from "node:assert/strict";
import test from "node:test";

import { assertFreightParentPreflight } from "../lib/freightParentPreflight.ts";

test("parent preflight sends the freight and acting wallet", async () => {
  const originalFetch = globalThis.fetch;
  let sentBody: unknown;
  globalThis.fetch = async (_input, init) => {
    sentBody = JSON.parse(String(init?.body));
    return Response.json({ allowed: true });
  };
  try {
    await assertFreightParentPreflight("child", "ckt1participant");
    assert.deepEqual(sentBody, { campaignId: "child", participantAddress: "ckt1participant" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parent preflight rejects pending parents and network failures", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: "Complete the parent freight before interacting with this child freight" }, { status: 409 });
    await assert.rejects(assertFreightParentPreflight("child", "ckt1participant"), /Complete the parent freight/);

    globalThis.fetch = async () => { throw new Error("Network unavailable"); };
    await assert.rejects(assertFreightParentPreflight("child", "ckt1participant"), /Network unavailable/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
