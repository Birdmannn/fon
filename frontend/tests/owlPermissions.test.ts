import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { ccc } from "@ckb-ccc/connector-react";
import { FREIGHT_PERMISSIONS, FREIGHT_MESSAGE_PERMISSIONS, FREIGHT_TRANSACTION_PERMISSIONS, installPermissionHandler, resolveFreightMessagePermission, resolveFreightPermission, signFreightMessage, sendFreightTransaction } from "../lib/owlPermissions.ts";

test("signing fails closed without an Owl permission controller", async () => {
  let called = false;
  const signer = { signMessage: async () => { called = true; } } as unknown as ccc.Signer;
  await assert.rejects(signFreightMessage(signer, "interaction-like", "nonce"), /select signing permissions/);
  assert.equal(called, false);
});

test("unregistered capabilities cannot reach a wallet", () => {
  assert.throws(() => resolveFreightPermission("arbitrary-transfer"), /Unknown Freight signing permission/);
  assert.equal(new Set(FREIGHT_PERMISSIONS.map(([id]) => id)).size, FREIGHT_PERMISSIONS.length);
});

test("transaction-only actions cannot be requested as message signatures", () => {
  for (const id of ["create-campaign", "buy-tickets", "creator-tip"]) {
    assert.throws(() => resolveFreightMessagePermission(id), /not a message permission/);
    assert.throws(() => signFreightMessage({} as ccc.Signer, id, "nonce"), /not a message permission/);
  }
  for (const [id] of FREIGHT_PERMISSIONS) {
    assert.ok([...FREIGHT_TRANSACTION_PERMISSIONS, ...FREIGHT_MESSAGE_PERMISSIONS].includes(id), id);
  }
  assert.equal(resolveFreightMessagePermission("deposit"), "deposit");
  assert.equal(resolveFreightMessagePermission("creator-withdraw"), "creator-withdraw");
});

test("both transaction and message signing honor a denied capability", async () => {
  let called = false;
  const signer = {
    signMessage: async () => { called = true; },
    sendTransaction: async () => { called = true; },
  } as unknown as ccc.Signer;
  const cleanup = installPermissionHandler(async () => { throw new Error("Permission denied"); });
  try {
    await assert.rejects(signFreightMessage(signer, "interaction-like", "nonce"), /Permission denied/);
    await assert.rejects(sendFreightTransaction(signer, "creator-tip", {} as ccc.Transaction), /Permission denied/);
    assert.equal(called, false);
  } finally { cleanup(); }
});

test("approved signing preserves the original message and signature", async () => {
  const proof = { signature: "owner-proof" };
  const signer = { signMessage: async (message: unknown) => { assert.equal(message, "nonce:digest"); return proof; } } as unknown as ccc.Signer;
  const cleanup = installPermissionHandler(async (owner, permission, operation) => {
    assert.equal(owner, signer);
    assert.equal(permission, "profile-photo");
    return operation(owner);
  });
  try { assert.equal(await signFreightMessage(signer, "profile-photo", "nonce:digest"), proof); }
  finally { cleanup(); }
});

test("app signing call sites cannot bypass the permission gateway", () => {
  const scan = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.tsx?$/.test(path) && !["owlPermissions.ts", "pilotWallet.ts"].includes(entry.name)) {
        assert.doesNotMatch(readFileSync(path, "utf8"), /\.(?:signMessage|sendTransaction|signTransaction|signOnlyTransaction)\s*\(/, path);
      }
    }
  };
  scan("app");
  scan("lib");
});
