# Raffle Participant Identity Bug

## Context

During raffle settlement debugging, we found a fundamental identity bug in how participant cells were linked to campaigns.

The issue showed up when clicking **Share2** for raffle settlement: users could have bought valid tickets, but settlement could still behave as if there were no eligible winners or no participants at all.

---

## The Original Logic

Originally, each participant cell stored a reference to the campaign using the campaign cell’s **current outpoint** at the time the participant entered.

That meant participant data encoded:
- `campaign_tx_hash`
- `campaign_index`

In other words, a participant was linked to the specific on-chain **instance** of the campaign cell that existed when the ticket was bought.

---

## What Was Meant to Happen

The intended product behavior was:
- a raffle remains the **same raffle** across its lifecycle
- buying a ticket permanently makes a participant eligible for that raffle
- later campaign state updates should not make that participant disappear
- settlement should always find all valid, verified participants for the same logical campaign

So even if the campaign moves through:
- creation
- activation
- deposits / ticket purchases
- completion
- settlement

participants should remain tied to the **same raffle identity** throughout.

---

## What Actually Happened

What actually happened was this:

1. A participant bought a raffle ticket.
2. The participant cell was created using the campaign cell’s **then-current** outpoint.
3. Later, the campaign cell was consumed and recreated during normal lifecycle transitions.
4. Settlement then tried to find participants using the **latest** campaign cell outpoint.
5. The participant’s stored campaign reference no longer matched the latest campaign outpoint.
6. As a result, valid participants could become invisible to settlement.

This created symptoms like:
- zero participants found even though tickets had been purchased
- zero winners produced from settlement preview/build logic
- divide-by-zero or invalid divisor settlement errors
- contract-side participant mismatch failures during `batch_deliver`

---

## Why the Original Logic Was Wrong

The core mistake was using a **mutable identity** for something that should have been stable.

A campaign cell outpoint changes whenever the campaign cell is consumed and recreated.
That makes it a poor long-term identity for participants.

The logical campaign did **not** change — only the current cell instance changed.
So participant linkage should never have depended on that mutable outpoint.

---

## The Fix

The fix was to replace mutable outpoint-based participant identity with a **stable campaign identity**.

Instead of storing:
- `campaign_tx_hash`
- `campaign_index`

participant cells now store stable campaign attributes such as:
- `campaign_created_by`
- `campaign_created_at`
- `campaign_type`

These fields do not change when the campaign cell is recreated, so they remain a reliable identity anchor across the campaign lifecycle.

### Contract-side fix
The contract was updated so that:
- participant schema uses stable identity fields
- participant parsing reads the new stable identity layout
- `collect_verified_participants(...)` matches against stable identity
- `validate_participant_added(...)` validates against stable identity
- `validate_refund_outputs(...)` validates against stable identity
- `batch_deliver(...)` collects and validates winners using stable identity

### Frontend-side fix
The frontend was updated so that:
- raffle ticket purchase writes participant cells using the same stable campaign identity
- participant fetching filters using stable identity
- settlement preview and transaction building align with the contract’s stable identity model

---

## What Was Learned

### 1. Cell outpoints are not the same thing as business identity
An on-chain cell outpoint identifies a **specific cell instance**, not necessarily the stable logical entity the app cares about.

### 2. Lifecycle recreation must be accounted for explicitly
If a design expects a cell to be consumed and recreated, anything linked to it must use a stable identity rather than the latest outpoint.

### 3. Frontend and contract identity models must evolve together
A stable-identity fix like this cannot live only in the frontend or only in the contract. Encoding, matching, validation, and tests must all be updated together.

### 4. Settlement bugs can masquerade as math bugs
The visible error looked like a settlement math problem at first, but the underlying cause was identity mismatch and participant invisibility.

### 5. A product-level question often reveals the correct model
The deciding question was simple:

> Is this still the same raffle after the campaign cell is recreated?

The answer is clearly yes.
Therefore the participant identity had to be stable across those recreations.

---

## Summary

### Bug
Participants were linked to a mutable campaign cell outpoint.

### Intended behavior
Participants should stay attached to the same logical raffle across campaign state transitions.

### Actual behavior
Participants could disappear from settlement lookup once the campaign cell was recreated.

### Fix
Replace outpoint-based participant linkage with stable campaign identity.

### Result
Settlement logic can now reason about the same logical raffle across state transitions, instead of accidentally treating each new campaign cell instance as a different campaign.
