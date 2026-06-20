# Contract Cell Capacity Recovery and Local Frontend Testing

This note captures two operational lessons learned during recent iteration on FreightOnNervos:

1. **A deployed contract/code cell on CKB locks capacity, and that capacity can be recovered by spending the cell back** when the deployment is no longer needed.
2. **Frontend development does not need to depend on public testnet + faucet CKB for every iteration**, even if a normal browser wallet does not support your local devnet directly.

---

## 1. Contract / Code Cells on CKB Consume Capacity

On CKB, a deployed script is just a cell that:
- stores the contract binary in `data`
- is later referenced through `cellDeps`
- locks real capacity while it exists on-chain

That means repeated redeploys consume more and more CKB unless old code cells are intentionally reclaimed or reused.

### What “reclaiming” means
Reclaiming a contract cell means:
- spending that old deployed code cell
- returning its locked capacity to an address you control
- accepting that this particular deployed contract cell will no longer be available as a script dependency

### When reclaiming is safe
Reclaiming a code cell is safe when:
- you are sure you no longer care about that deployment
- no important live flows still need that exact deployed code cell
- you have confirmed the exact outpoint and owner address involved

### When reclaiming is dangerous
It is dangerous when:
- active state cells still depend on that script deployment
- you still want to use that code cell as a dep for future txs
- you are not certain which deployment profile / outpoint you are spending

### Repo sources of truth for old deployed code cells
This repo already records useful deployment history in:
- `deployment/migration/`
- `deployment/migration-fresh/`
- `deployment/txs/`

Examples:
- default profile freight cell:
  - `deployment/migration/2026-03-21-144156.json`
  - tx hash: `0xb893f0d342fce1f29a0d093a517112e65801a1f4380a759ec843aeb0e72bb5b7`
  - index: `0`
- fresh profile freight cell:
  - `deployment/migration-fresh/2026-06-15-142354.json`
  - tx hash: `0x22b114ce2919255d7c815e82cfd712d7041ab990aa576dd0ab1f95582cca8bb2`
  - index: `0`

These files should be treated as the first place to look before reclaiming anything.

---

## 2. Why Public Testnet Redeploy-Per-Tweak Is Expensive

If every small contract tweak is deployed to public testnet, then each new deployment:
- locks more test CKB in another code cell
- depends on faucet availability
- slows down development
- makes it harder to keep track of which deployment is actually important

The result is exactly what we ran into:
- fast iteration becomes limited by faucet distribution caps
- old contract cells accumulate and trap capacity

The right long-term fix is to separate:
- **local iteration**
- **selected public testnet validation**

instead of treating public testnet as the default development loop.

---

## 3. “Native Simulation” vs Frontend Testing

### Native simulation
Native simulation is primarily about the **contract**, not the browser UI.

It means:
- running the contract logic locally in tests
- validating script behavior without needing public testnet deployments
- using Rust tests / local tooling to catch contract bugs quickly

In this repo, the key places are:
- `tests/src/tests.rs`
- `Makefile`
- devnet and contract build tooling under `scripts/`

### Frontend testing
Frontend testing is different.

You can test the frontend in three broad ways:

1. **UI/component logic**
   - local React/UI behavior
   - validation, layout, state transitions, rendering

2. **Full app against local infrastructure**
   - frontend + local RPC/devnet + signer

3. **Occasional public testnet milestone validation**
   - only once the flow is already mostly stable

So the better development split is:
- **contract bugs** → Rust tests / native simulation / local chain tooling
- **frontend bugs** → local frontend testing
- **full transaction flow** → local devnet with a dev signer when possible

---

## 4. Why Browser Wallets Make Local Devnet Awkward

A normal browser wallet often supports:
- mainnet
- public testnet

but **not your custom local devnet** in a plug-and-play way.

So a frontend that assumes “browser extension wallet = only signing path” becomes awkward to test locally, even if the local chain itself is working fine.

This does **not** mean local frontend testing is impossible.
It means the browser wallet should not be the only signer available during development.

---

## 5. Better Local Frontend Strategy

The practical alternative is a **dev-only signer** for local use.

That means:
- the frontend talks to local devnet RPC
- the signer is provided from development config (for example, a local private key)
- browser-wallet flows remain available for public testnet/mainnet use
- local iteration no longer depends on faucet CKB

### Why this is a good fit here
The app already uses CCC as the wallet abstraction throughout:
- `frontend/app/providers.tsx`
- `frontend/app/page.tsx`
- `frontend/app/campaign/[campaignId]/page.tsx`
- `frontend/lib/transactions.ts`

So a dev-only signer can fit under the existing abstraction instead of requiring a second transaction stack.

---

## 6. Recommended Workflow Going Forward

### For contract iteration
Use:
- Rust tests
- local script simulation / native-style contract testing
- local devnet if needed

Only deploy to public testnet when:
- the change is stable enough to justify a real deployment

### For frontend iteration
Use:
- the frontend locally
- mocked or dev-only signer paths when necessary
- local RPC/devnet once the dev signer is available

### For public testnet
Use it for:
- milestone validation
- wallet-extension reality checks
- not for every small tweak

---

## 7. Operational Safety Checklist Before Reclaiming a Contract Cell

Before consuming an old deployed freight code cell, confirm all of the following:

1. You know the exact outpoint:
   - tx hash
   - index
2. You know which deployment profile it came from:
   - default vs fresh
3. The outpoint is still unspent
4. The lock belongs to an address you control
5. You truly no longer care about that deployed contract cell
6. No important live flow still depends on that deployment
7. You have inspected the reclaim transaction before broadcasting

---

## 8. Summary

### What we learned
- A CKB contract deployment is a capacity-consuming cell, not a free floating code object.
- If an old deployment is obsolete, its capacity can be recovered by spending the code cell back.
- Public testnet should not be the default loop for heavy contract iteration.
- Native/local contract testing and local frontend testing solve different problems.
- Browser wallets make local devnet awkward, but a dev-only signer path can remove that limitation.

### What this means for FreightOnNervos
The healthiest development loop is:
- contract work locally first
- frontend work locally first
- public testnet only when the flow is mature enough to justify a real deployment and real wallet validation
