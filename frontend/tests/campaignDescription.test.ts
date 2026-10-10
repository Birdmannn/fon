import assert from "node:assert/strict";
import test from "node:test";

import { compactDescriptionBlankLines } from "../lib/campaignDescription.ts";

test("freight descriptions show at most one blank line between text blocks", () => {
  assert.equal(
    compactDescriptionBlankLines("First\n\n\n \t\nSecond\r\n\r\n\r\nThird"),
    "First\n\nSecond\n\nThird",
  );
  assert.equal(compactDescriptionBlankLines("First\nSecond"), "First\nSecond");
});
