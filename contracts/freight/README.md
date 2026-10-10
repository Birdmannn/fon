# Freight contract

Raffles and gifted FundedTask freights can carry an optional `APV1` approval extension. Existing campaign data
without this extension keeps its existing behavior. The type-script arguments
fix the approval stage, threshold, and full approver lock hashes at creation.

## Approval rules

- Stage 1 (on commencement) requires a positive start delay. The threshold must
  be recorded in a block strictly before `created_at + start_delay * 1000`.
  Until approved, the raffle cannot accept support, tickets, status changes,
  draws, claims, or rollover. A missed deadline permits only cancellation,
  followed by the normal cancelled-freight recovery actions.
- Stage 2 (on delivery) is available only for ordinary raffles and requires all
  tagged approvers. Ticket entry remains available, but distribution and escrow
  withdrawal require approval. Cancellation still permits recovery.
- Recurring raffles use stage 1 only. Its approval is retained across every round.
- Stage 3 (gift commencement) supports all/threshold approvals on FundedTask
  gifts. It has no raffle approval deadline and does not require selector 14.
  The start delay still controls the earliest commencement. Support remains
  available while approvals are pending; commencement, participant verification,
  distribution and creator withdrawal require quorum. Cancellation permits
  normal recovery. Gift claims read the live cell, never MongoDB approval flags.

## Encoding and actions

The extension is `[APV1 (4)][stage (1)][required (1)][count (1)]
[confirmed (1)][lock_hash (32), approved (1)] * count`, with 1–32 distinct,
nonzero lock hashes. Initial flags must all be zero. It starts at byte 198 in
ordinary campaign data, byte 254 in recurring data, and byte 90/106 in the full
creation script arguments (including selector 0). Creation includes the
8-byte tickets-per-user field whenever the extension is present. For gifts,
that field is a reserved zero and carries no ticket meaning.

Selector 13 takes a single approver index and requires a matching signed wallet
input. It can update only that wallet's approval bit; capacity, lock, other votes,
and recurring state must be preserved. Gated script groups permit exactly one
campaign input/output, preventing extra cells with forged approval flags.

Selector 14 confirms commencement quorum using the campaign input's **actual
inclusion header** (`Source::GroupInput`), supplied as a header dependency.
The threshold-setting cell is frozen until confirmation or cancellation, so
subsequent writes cannot replace that proof. A stale caller-supplied tip header
cannot make a late quorum valid. Confirmation may happen after the deadline if
the quorum itself was mined before it. The frontend waits for the final vote to
be mined and then requests this confirmation transaction automatically.

## Gift claim rules

A FundedTask gift created by the updated frontend also carries an immutable
`GFT1` policy in its creation script arguments and campaign data. The policy is
`[GFT1 (4)][open (1)][slot_count (1)][creator_lock_hash (32)]`, followed by
`[claimant_lock_hash (32)][allocation_shannons (8)][claimed (1)]` for each slot.
It follows `APV1` when approvals are present and otherwise begins at the normal
extension offset. The reserved tickets-per-user field remains zero.

There are 1–32 allocations, whose exact amounts sum to the gift's maximum amount.
Tagged wallets have one fixed allocation each, including any ratio split and
rounding remainder calculated at creation. Open claims use equal allocations,
putting the division remainder in the final slot. Each open slot starts with a
zero claimant hash and records the signing wallet when claimed. Each full wallet
lock hash can claim at most once, across all slots in this gift.

Selector 15 takes `[slot_index (1)][claiming_lock_hash (32)]`. It requires a
signed input for that wallet, the start time, completed gift approvals, full
funding before the first claim, and enough escrow for the allocation. It pays
the claiming wallet directly, marks only its slot, and reduces both escrow data
and campaign capacity by exactly the fixed allocation. The wallet's net plain
CKB increase must cover the allocation less the actual network fee; that fee is
bounded at 0.01 CKB and must be smaller than the allocation. Existing recipient
inputs, typed cells, other outputs, permissive state locks, clone outputs, or
another campaign group cannot substitute for the payout.

Legacy participant verification, batch delivery, randomness changes, status
updates, and early creator withdrawal cannot bypass the policy. The final claim
completes the gift. The fixed creator wallet can cancel before completion, then
recover unclaimed escrow with selector 8; it can also recover surplus after all
claims. Campaign locks and all immutable policy fields remain unchanged.

`@receive` payment streaming is unsupported. Gift creation rejects it. `@claim`
now sends a wallet transaction; the old database-only claim API returns 409.
Gift eligibility and payout amounts never depend on mutable database metadata.
Older gifts need recreation because their existing type arguments lack this
policy. This policy needs an updated contract deployment before publication.

## Build, test, and activation

```sh
make -C contracts/freight build TOP="$PWD/" BUILD_DIR=build/release
cargo test -p tests -- --test-threads=1
```

Deploy the rebuilt `build/release/freight` using the repository's deployment
workflow. Configure the frontend's `NEXT_PUBLIC_FREIGHT_CODE_HASH`,
`NEXT_PUBLIC_FREIGHT_HASH_TYPE`, `NEXT_PUBLIC_FREIGHT_OUTPOINT_TX_HASH`, and
`NEXT_PUBLIC_FREIGHT_OUTPOINT_INDEX` for that deployment and rebuild the
frontend. Approval creation is enabled directly, without feature flags. Existing
gifts with off-chain approval lists must be recreated to use the immutable
on-chain gate; their old database approvals cannot unlock new gifts.
No deployment is performed by building or testing these changes.

## Current testnet deployment

The fresh profile was redeployed on 2026-10-10 after reclaiming the previous
code cell. The transaction is committed, and the live bytes exactly match the tested `build/release/freight`,
including `APV1` approvals and `GFT1` claim policies.

- Transaction: `0xd5baeb3225bc7cb8558b849148e5a77c6616edc1c228dbe701dcff52e98495a3`, output 0.
- Type script hash: `0x5724d09f04556e046c2deb3cb870883526545a1eedf67779e09b2cce0559ce3c`.
- Binary data hash: `0x5a644fe5590e290cffd45523940eff02f9d0b33e6bd03909bfa564987a7a5b3b`.
- Contract capacity: 167,694 CKB; deployment fee: 0.00168169 CKB.
- Reclaim transaction: `0x85f316c3622736bd38a1cb5b690102a8bb4b9296e0f7bf190e80c6baf6eaa013`.
- Reclaimed capacity: 167,693.99 CKB; reclaim fee: 0.01 CKB.

Previous fresh-profile records are retained in
`deployment/archive-fresh-20261010-225702`, including the reclaim transaction.
Earlier records remain in `deployment/archive-fresh-20261009-212258` and
`deployment/archive-fresh-20261009-203824`. The deployed contract enforces gift
approvals, tagged claimant eligibility, fixed equal/ratio allocations, one claim
per wallet, and direct claim payouts. `@receive` payment streaming is unsupported.
Older gifts need recreation to obtain immutable claim rules. This fresh deployment
has a new type script hash; cells referencing the consumed deployment cannot use
this replacement as their original code dependency.
