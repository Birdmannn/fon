# V4 Implementation Notes

## Context

During the raffle settlement debugging work in v3, we uncovered a deeper architectural issue in how participant cells are modeled and discovered.

The current system treats participant cells as **lock-only cells with structured data**, and not as first-class typed on-chain objects. That design works in simple cases, but it creates two major problems as the raffle lifecycle becomes more complex:

1. **Participant identity was tied to mutable campaign outpoints**
2. **Participant discovery is awkward and fragile because participant cells have no type script of their own**

We began a stable-identity migration in v3 to fix the first issue, but the second issue made it clear that the long-term architecture should evolve in v4.

---

## What We Observed

### 1. Participant cells were not first-class typed objects
In the current architecture, participant cells are created as:
- lock-only cells
- with participant data stored in output data
- with no dedicated participant type script

This means the system recognizes them indirectly by:
- expected data length
- payload decoding
- surrounding transaction context

That is workable, but it makes participant lookup and lifecycle management more fragile than necessary.

### 2. Mutable outpoint identity caused real settlement bugs
The original participant model used the campaign cell’s outpoint (`tx hash + index`) as the participant’s durable campaign reference.

That was flawed because campaign cells are consumed and recreated over time.

Result:
- valid participants could become invisible after campaign state transitions
- settlement could fail with zero participants / zero winners symptoms
- the logical campaign stayed the same, but the outpoint changed underneath it

### 3. Even after moving toward stable identity, participant discovery remains awkward
After moving toward a stable participant identity model, there is still an architectural limitation:
- the frontend has to discover participant cells by scanning broad cells and decoding/filtering them manually
- there is no explicit participant-type marker on-chain to query against directly

So while stable identity fixes the outpoint-linkage bug, the participant model is still harder to index, validate, and reason about than it needs to be.

---

## What Was Intended vs What Actually Happened

### Intended
Participants in a raffle should:
- remain attached to the same logical raffle across campaign lifecycle transitions
- stay discoverable for settlement and refund flows
- be represented in a way that is easy to validate and query

### Actual
Participants were:
- linked to mutable campaign cell outpoints
- easy to lose from settlement lookup after campaign recreation
- represented only as lock-only data cells, making off-chain discovery more complex than necessary

---

## V4 Direction

For v4, the plan is to move from the current **lock-only participant cell** design toward a **participant-type-script architecture**.

This means participant cells would become explicit, typed on-chain objects instead of being recognized only by data shape.

---

## Proposed V4 Architecture

## Option Selected for v4

The preferred v4 direction is:

### **Dedicated participant type script**
Introduce a separate participant contract or participant-typed cell model, so that participant cells are no longer just generic lock-only cells.

This gives us:
- explicit participant-cell identity on-chain
- easier participant discovery
- clearer lifecycle rules
- cleaner settlement and refund validation paths

---

## How it would look conceptually

### Campaign cell
- type script: `freight`
- data: campaign state

### Participant cell
- type script: `participant`
- data: participant state linked to a stable campaign identity

### Stable campaign identity in participant data
Participant cells should still store a stable campaign identity, most likely built from:
- `campaign_created_by`
- `campaign_created_at`
- `campaign_type`

This preserves logical campaign identity even when the campaign cell is recreated.

---

## Why this is better

### 1. Easier participant discovery
Instead of scanning arbitrary lock-only cells and filtering by data layout, the system can query:
- participant typed cells
- for a specific stable campaign identity

### 2. Clearer on-chain semantics
A participant cell becomes an explicit first-class entity rather than “a cell that happens to have the right data shape.”

### 3. Cleaner settlement/refund logic
Settlement and refund flows can operate over a dedicated participant cell class, reducing ambiguity and reducing reliance on positional assumptions.

### 4. Better long-term maintainability
As raffles become more important, analytics, explorers, admin tooling, and debugging all benefit from explicit participant objects.

---

## Tradeoff

This is a more complex architecture than the current model.

### Costs
- another contract or another explicit participant script mode
- more deployment complexity
- more tests
- more migration work

### Benefits
- stronger identity model
- easier indexing
- more reliable settlement/refund discovery
- simpler reasoning about participant lifecycle over time

For v4, that tradeoff is worth it.

---

## Recommended v4 Implementation Plan

1. **Define participant cells as typed objects**
   - Introduce a participant type script or participant-mode script identity.

2. **Keep stable campaign identity in participant data**
   - Do not return to mutable campaign outpoint linkage.

3. **Update contract flows together**
   - participant creation
   - settlement
   - refund
   - validation helpers

4. **Update frontend encoding and queries together**
   - participant encoding/decoding
   - participant fetching/indexing
   - settlement preview
   - refund/eligibility lookup

5. **Add dedicated tests for participant lifecycle**
   - creation
   - state transition
   - settlement after campaign recreation
   - refund after campaign recreation

---

## What We Learned

1. **Mutable outpoints are not suitable long-term business identity keys** when the cell is expected to be recreated.
2. **Stable identity and explicit queryability are different concerns** — fixing one does not fully solve the other.
3. **Lock-only cells are cheap and simple, but harder to discover reliably** at scale.
4. **Participant cells have grown important enough to deserve stronger first-class modeling**.
5. **v4 should favor correctness and explicitness over minimalism** in the participant architecture.

---

## Summary

### v3 observation
- The original participant model was too dependent on mutable outpoints and too implicit in how participant cells were represented.

### v4 decision
- Move to a participant-type-script architecture.
- Keep stable campaign identity in participant data.
- Make participant cells first-class typed objects so settlement, refund, and discovery are more reliable.
