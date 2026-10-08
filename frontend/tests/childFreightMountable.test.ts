import assert from "node:assert/strict";
import test from "node:test";

import { hasParticipantCreatedChildFreight, parseChildFreightMountableConfig } from "../app/_lib/childFreightMountable.ts";

test("child freight mountable matches its participant and optional title", () => {
  const children = [{ creatorAddress: "CKT1ALICE", title: "  My Child  " }];
  assert.equal(hasParticipantCreatedChildFreight("ckt1alice", { enabled: true, title: "my child" }, children), true);
  assert.equal(hasParticipantCreatedChildFreight("ckt1alice", { enabled: true, title: "" }, children), true);
  assert.equal(hasParticipantCreatedChildFreight("ckt1bob", { enabled: true, title: "my child" }, children), false);
  assert.equal(hasParticipantCreatedChildFreight("ckt1alice", { enabled: true, title: "another" }, children), false);
  assert.equal(hasParticipantCreatedChildFreight("ckt1alice", { enabled: true, title: "" }, []), false);
});

test("child freight mountable validates stored title length", () => {
  assert.deepEqual(parseChildFreightMountableConfig({ enabled: true, title: "  Child  " }), { enabled: true, title: "Child" });
  assert.throws(() => parseChildFreightMountableConfig({ enabled: true, title: "x".repeat(31) }));
  assert.throws(() => parseChildFreightMountableConfig({ enabled: "true" }));
});
