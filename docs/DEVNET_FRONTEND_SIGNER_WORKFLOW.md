# Devnet Frontend Signer Workflow

This note describes the intended local-development workflow for FreightOnNervos when a normal browser wallet does not support a custom local devnet.

---

## 1. The Problem

The frontend currently uses CCC and browser-wallet-style connection flows. That works well for:
- mainnet
- public testnet

But it is awkward for a local devnet because browser wallets often do **not** support a custom local CKB network in a way that matches day-to-day development.

As a result, local full-stack iteration can stall even when:
- the local node is running
- the contract is deployed locally
- the frontend itself is otherwise ready

---

## 2. The Better Local Setup

The better development split is:

### Contract logic
Use:
- Rust tests
- local/native simulation
- local devnet when needed

### Frontend UI/UX
Use:
- the frontend locally
- a dev-only signer path when a real extension wallet is unavailable

### Public testnet
Use it only for:
- milestone validation
- final wallet-extension reality checks
- not every small tweak

---

## 3. What a Dev Signer Means Here

A **dev signer** is a local development-only signing path that:
- talks to a local CKB RPC/devnet
- uses a locally controlled key
- satisfies the same signer interface the app already expects
- avoids the need for a browser extension wallet during local iteration

The goal is **not** to replace CCC.
The goal is to keep using CCC’s abstraction while adding a development-only signer mode underneath it.

---

## 4. Existing Reusable Pieces in This Repo

### Frontend config
- `frontend/app/providers.tsx`
- `frontend/.env.example`
- `frontend/.env.local`
- `frontend/lib/contract.ts`

### Wallet / signer usage
- `frontend/app/page.tsx`
- `frontend/app/campaign/[campaignId]/page.tsx`
- `frontend/lib/transactions.ts`

### Local chain tooling
- `scripts/devnet.sh`
- `Makefile`

The app already centralizes transaction building around a CCC signer, which is exactly why a dev-only signer is practical.

---

## 5. Recommended Devnet Frontend Workflow

### Step 1 — Boot local devnet
Use the repo’s existing tooling to start the local chain and deploy the contract locally.

Examples:
- `make devnet-start ...`
- `scripts/devnet.sh start ...`

### Step 2 — Point the frontend to local RPC
Use frontend env config such as:
- `NEXT_PUBLIC_CKB_RPC_URL=http://127.0.0.1:8114`
- `NEXT_PUBLIC_CKB_NETWORK=devnet`

### Step 3 — Use a dev-only signer
The intended next step for this repo is to support a local signer path so the frontend can sign/send txs directly against devnet without a browser extension wallet.

### Step 4 — Test real full-stack flows locally
Once the dev signer exists, the local loop becomes:
- start devnet
- run frontend
- use dev signer
- test create / deposit / ticket purchase / settlement locally

---

## 6. Why This Is Better Than Public Testnet for Daily Iteration

This workflow:
- avoids faucet limits
- avoids locking capacity in many unnecessary testnet deployments
- allows faster contract and UI iteration
- makes public testnet a final-validation environment instead of the default development environment

---

## 7. Practical Notes

### Browser-wallet path still matters
The normal wallet flow is still important for:
- public testnet
- mainnet
- user-realistic validation

The dev signer is for development convenience, not as the primary production wallet path.

### Documentation should stay in sync with implementation
When the dev signer is added, update this note with:
- exact env variables
- how to enable it
- any security warnings about local private keys
- the exact commands to boot local devnet and launch the frontend

---

## 8. Summary

### What we learned
- A frontend does not need to depend on a browser extension wallet for every development loop.
- A local devnet is still valuable even if browser wallets do not support it directly.
- The missing piece is a development-only signer path, not a different transaction layer.

### What this means for FreightOnNervos
The most sustainable workflow is:
- contract iteration locally first
- frontend iteration locally first
- public testnet only when changes are stable enough to justify a real deployment and real wallet validation
