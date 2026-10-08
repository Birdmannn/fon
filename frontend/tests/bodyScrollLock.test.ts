import assert from "node:assert/strict";
import test from "node:test";

import { lockBodyScroll } from "../app/_lib/bodyScrollLock.ts";

test("body stays locked until every overlay releases its lock", () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const body = { style: { overflow: "auto" } };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { body } });

  try {
    const releaseCreate = lockBodyScroll();
    const releaseViewer = lockBodyScroll();
    assert.equal(body.style.overflow, "hidden");

    releaseCreate();
    assert.equal(body.style.overflow, "hidden");
    releaseViewer();
    assert.equal(body.style.overflow, "auto");

    const releaseAgain = lockBodyScroll();
    releaseAgain();
    releaseAgain();
    assert.equal(body.style.overflow, "auto");
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
