import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import type { Collection, Document } from "mongodb";

const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { awardFbarsEvent, computeWalletSeedFbars } = jiti("../lib/fbars.ts") as typeof import("../lib/fbars.ts");

test("simultaneous sessions can seed one owner only once", async () => {
  const owner = "ckt1-owner-profile";
  let inserted = false;
  let updates = 0;
  const profiles = {
    findOne: async () => ({ fbars: 0 }),
    updateOne: async (filter: { address: string }, update: { $set: { fbars: number } }) => {
      assert.equal(filter.address, owner);
      assert.equal(update.$set.fbars, 2);
      updates++;
    },
  } as unknown as Collection<Document>;
  const events = {
    findOne: async () => null, // Both callers can observe the event as missing.
    insertOne: async () => {
      if (inserted) throw Object.assign(new Error("duplicate key"), { code: 11000 });
      inserted = true;
    },
  } as unknown as Collection<Document>;
  const seed = () => awardFbarsEvent({
    address: owner, weekKey: "2026-10-19", eventKey: `wallet-seed:${owner}`,
    kind: "wallet-seed", delta: computeWalletSeedFbars(2500n * 100_000_000n),
    profilesCollection: profiles, eventsCollection: events,
  });
  const results = await Promise.all([seed(), seed()]);
  assert.equal(results.filter(result => result.applied).length, 1);
  assert.equal(updates, 1);
});
