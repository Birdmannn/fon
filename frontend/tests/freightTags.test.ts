import assert from "node:assert/strict";
import test from "node:test";
import { buildFreightTagGroups, fitFreightTagRow, stripFreightUserTags } from "../lib/freightTags.ts";

test("role rows precede ordinary tags and users appear only once across all rows", () => {
  const groups = buildFreightTagGroups({
    description: "Hello @visitor @approve @Alice.ckb @alice @claim @alice @Bob.ckb @receive @carol",
    mentions: ["alice", "BOB.ckb", "visitor", "dave", "dave.ckb", "approve"],
    profiles: { alice: { displayName: "Alicia", address: "wallet-a" }, bob: { displayName: "Robert", address: "wallet-b" } },
  });
  assert.deepEqual(groups.map((group) => [group.role, group.users.map((user) => user.handle)]), [
    ["approve", ["alice"]], ["claim", ["bob"]], ["receive", ["carol"]], ["other", ["visitor", "dave"]],
  ]);
  assert.equal(groups[0].users[0].displayName, "Alicia");
  assert.equal(groups[1].users[0].displayName, "Robert");
});

test("wallet aliases are not repeated, but unrelated users with the same name remain", () => {
  const groups = buildFreightTagGroups({
    approvers: [{ handle: "alice", address: "WALLET-A" }],
    claimants: [{ handle: "alias", address: "wallet-a" }, { handle: "bob", address: "wallet-b" }],
    profiles: { alice: { displayName: "Alex", address: "wallet-a" }, bob: { displayName: "Alex", address: "wallet-b" } },
  });
  assert.deepEqual(groups.map((group) => group.users.map((user) => user.handle)), [["alice"], ["bob"]]);
});

test("profile lookup also deduplicates ordinary tags by wallet", () => {
  const groups = buildFreightTagGroups({
    mentions: ["alice", "alias"],
    profiles: { alice: { displayName: "Alicia", address: "wallet-a" }, alias: { displayName: "Alicia", address: "wallet-a" } },
  });
  assert.equal(groups[0].users.length, 1);
});

test("unresolved tags never fall back to showing handles as display names", () => {
  const users = buildFreightTagGroups({ mentions: ["not-found"], profiles: { "not-found": null } });
  assert.equal(users[0].users[0].displayName, "Unknown user");
});

test("rows fit all complete chips at the exact available width", () => {
  assert.equal(fitFreightTagRow([40, 40, 40], 132, 6, [0, 20, 20, 20]), 3);
});

test("overflow reserves its own width and the correct spacing", () => {
  assert.equal(fitFreightTagRow([40, 40, 40], 112, 6, [0, 20, 20, 20]), 2);
  assert.equal(fitFreightTagRow([40, 40, 40], 111, 6, [0, 20, 20, 20]), 1);
  assert.equal(fitFreightTagRow([40, 40, 40], 65, 6, [0, 20, 20, 20]), 0);
});

test("overflow adapts to wider counters with two digits", () => {
  const widths = Array(12).fill(40);
  const counters = Array.from({ length: 13 }, (_, count) => count >= 10 ? 28 : 20);
  assert.equal(fitFreightTagRow(widths, 113, 6, counters), 1);
  assert.equal(fitFreightTagRow(widths, 120, 6, counters), 2);
});

test("empty, narrow and single long-name rows stay on one line", () => {
  assert.equal(fitFreightTagRow([], 100, 6, [0]), 0);
  assert.equal(fitFreightTagRow([40, 40], 0, 6, [0, 20, 20]), 0);
  assert.equal(fitFreightTagRow([300], 100, 6, [0, 20]), 1);
});

test("body text does not repeat user tags and email addresses stay intact", () => {
  assert.equal(stripFreightUserTags("Hello @alice.ckb and @bob\nEmail alice@example.com"), "Hello  and \nEmail alice@example.com");
});
