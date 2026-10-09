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

## Build, test, and activation

```sh
make -C contracts/freight build TOP="$PWD/" BUILD_DIR=build/release
cargo test -p tests -- --test-threads=1
```

Deploy the rebuilt `build/release/freight` using the repository's deployment
workflow. Configure the frontend's `NEXT_PUBLIC_FREIGHT_CODE_HASH`,
`NEXT_PUBLIC_FREIGHT_HASH_TYPE`, `NEXT_PUBLIC_FREIGHT_OUTPOINT_TX_HASH`, and
`NEXT_PUBLIC_FREIGHT_OUTPOINT_INDEX` for that deployment. Then set
`NEXT_PUBLIC_FREIGHT_RAFFLE_APPROVALS_ENABLED=true` for raffles and
`NEXT_PUBLIC_FREIGHT_GIFT_APPROVALS_ENABLED=true` for gifting, and rebuild the
frontend. These flags prevent publishing against an older binary. Existing
gifts with off-chain approval lists must be recreated to use the immutable
on-chain gate; their old database approvals cannot unlock new gifts.
No deployment is performed by building or testing these changes.
