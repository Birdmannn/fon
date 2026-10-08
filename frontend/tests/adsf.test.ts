import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": process.cwd() } });
const { calculateAdsfUsdCents, shannonsToUsdCents } = jiti("../lib/adsf.ts");

test("ADSF adds received tips and rewards once per recorded event", () => {
  const result = calculateAdsfUsdCents("CKT-CREATOR", [
    { settledRecipients: [
      { address: "ckt-creator", amountShannons: "10000000000", creditedUsdCents: 42 },
      { address: "ckt-other", amountShannons: "10000000000", creditedUsdCents: 42 },
    ] },
  ], [
    { metadata: { amountShannons: "6100000000", adsfUsdCents: 25 } },
  ], 0.01);

  assert.deepEqual(result, { cents: 67, complete: true });
  assert.deepEqual(calculateAdsfUsdCents("CKT-CREATOR", [
    { settledRecipients: [{ address: "ckt-creator", creditedUsdCents: 42 }] },
  ], [{ metadata: { adsfUsdCents: 25 } }], null), result);
});

test("ADSF estimates older credits from CKB amounts when a price is available", () => {
  const rewards = [{ settledRecipients: [{ address: "ckt-creator", amountShannons: "10000000000" }] }];
  const tips = [{ metadata: { amountShannons: "6100000000" } }];

  assert.deepEqual(calculateAdsfUsdCents("ckt-creator", rewards, tips, 0.01), { cents: 161, complete: true });
  assert.deepEqual(calculateAdsfUsdCents("ckt-creator", rewards, tips, null), { cents: 0, complete: false });
  assert.equal(shannonsToUsdCents("6100000000", 0.01), 61);
});
