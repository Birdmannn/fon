# Raffle Randomness and Winner Selection

This document explains how raffle randomness should work in FreightOnNervos, why it is fair, and what remains to be implemented after the current safer-v1 commitment work.

---

## 1. Goal

Raffles only need randomness when there are more participants than available reward slots.

### Rule
- If `participant_count <= reward_count`
  - no randomness is needed
  - everyone eligible gets rewarded
- If `participant_count > reward_count`
  - randomness is required
  - exactly `reward_count` winners are selected from the participant set

This avoids unnecessary randomness when the outcome is already deterministic.

---

## 2. The fairness model

The intended fairness model is **commit → reveal → deterministic selection**.

### At campaign creation
The creator generates:
- a random 32-byte preimage
- a 32-byte commitment:
  - `randomness_hash = blake2b_256(preimage)`

Only the **hash** is stored on-chain initially.
The raw preimage is kept off-chain for later reveal.

### Why this matters
This prevents the creator from choosing randomness after seeing the participant set.

The commitment proves:
- the creator had already committed to one hidden random value earlier
- that value cannot later be changed without changing the hash

---

## 3. On-chain data involved

The existing campaign data already has the required fields:
- `reward_count`
- `randomness_hash`

Relevant contract structure:
- `contracts/freight/src/types.rs`

The frontend encoding/decoding already supports those fields too:
- `frontend/lib/encoding.ts`

---

## 4. Reveal step

After the campaign ends, if randomness is needed, the creator (or whoever is allowed by the contract flow) reveals the original 32-byte preimage.

The contract checks:

```text
blake2b_256(revealed_preimage) == campaign.randomness_hash
```

If they do not match:
- settlement fails

This is already reflected in the current `batch_deliver` verification path.

Relevant contract logic:
- `contracts/freight/src/instructions.rs`

---

## 5. Participant ordering must be deterministic

This is the most important missing fairness piece.

Random selection is only fair if everyone agrees on the exact ordering of participants **before** randomness is applied.

A recommended ordering rule is:
1. `joined_at` ascending
2. `participant_address` ascending
3. participant cell outpoint / index as final tie-break

### Why ordering matters
If participant order is ambiguous, then different implementations could produce different winner sets from the same randomness seed.

That would make the raffle disputable.

### Important
This ordering should come from **on-chain participant data**, not off-chain data.

---

## 6. Seed derivation

Once the preimage is revealed and accepted, derive a deterministic seed.

Example:

```text
seed = blake2b_256(
  revealed_preimage || campaign_tx_hash || campaign_index || participant_count
)
```

This makes the seed:
- deterministic
- campaign-specific
- participant-set-specific

The seed should be a 32-byte array.

---

## 7. Winner selection

The current implementation direction is deterministic shuffle.
Instead of repeated random draws with retries, the contract:
- builds a canonical participant order
- derives a deterministic seed from the revealed preimage and campaign identity
- runs a deterministic shuffle
- selects the first `reward_count` participants as winners

### Current high-level algorithm

1. Collect verified participant inputs
2. Order them canonically by:
   - `joined_at`
   - then `participant_address`
   - then campaign identity tie-break fields
3. Derive a 32-byte seed from:
   - revealed preimage
   - campaign transaction hash
   - campaign index
   - participant count
4. Shuffle the ordered list deterministically
5. Select the first `reward_count` participants as winners
6. Require only those winners to appear as `Rewarded` outputs in delivery

### Pseudocode shape

```text
participants = sort(participants, by joined_at, then address, then outpoint)
seed = blake2b_256(revealed_preimage || campaign_tx_hash || campaign_index || participant_count)
shuffled = deterministic_shuffle(participants, seed)
winners = shuffled[0..reward_count]
```

### Avoiding modulo bias
The shuffle should not use naïve `% n` reduction directly from raw random bytes.
Instead, the implementation should use rejection sampling:

1. derive a 64-bit candidate from a round hash
2. compute the largest acceptable threshold divisible by the target range
3. reject candidates outside that threshold
4. only then reduce into the required index range

This keeps winner selection uniform and avoids subtle bias in smaller index ranges.

### Why this is better than repeated draws
It avoids:
- duplicate-draw retry complexity
- ordering ambiguity
- edge-case bias in rejection loops

---

## 8. Distribution after winner selection

Once winners are determined:

```text
reward_per_winner = current_deposits / reward_count
```

Each winner receives:
- `reward_per_winner`

### Remainders
If `current_deposits` is not evenly divisible by `reward_count`, remainder handling must be explicit and deterministic.

Options include:
- leave remainder in campaign cell
- refund remainder to creator
- assign remainder by documented rule

This should be defined before production settlement.

---

## 9. What already exists vs what is missing

## Already present
- `reward_count` field in `Campaign`
- `randomness_hash` field in `Campaign`
- frontend support for encoding/decoding both
- contract-side reveal verification in `batch_deliver`
- contract-side randomness hash submission path
- create-time safer-v1 randomness commitment generation path

## Still missing
- final deterministic participant ordering rule in code
- deterministic winner-selection implementation
- frontend/admin settlement flow for reveal + winner selection + delivery tx construction
- final decision on remainder handling
- cleanup of any overlapping authority between create-time `reward_count` and later randomness submission flows

---

## 10. Diagram

```text
[Create Campaign]
    |
    | generate random 32-byte preimage
    | compute blake2b_256(preimage)
    v
[Store randomness_hash on-chain]
[Store preimage off-chain]
    |
    | participants join campaign
    v
[Campaign ends]
    |
    | if participant_count <= reward_count
    |    -> everyone gets rewarded
    |
    | else
    |    -> reveal preimage
    v
[Contract verifies preimage matches randomness_hash]
    |
    | build deterministic participant ordering
    | derive seed from preimage + campaign identity
    | shuffle/select first reward_count participants
    v
[Distribute reward_per_winner to winners]
```

---

## 11. Summary

The fairness guarantee comes from three things working together:

1. **Commitment before outcome is known**
2. **On-chain verifiable reveal**
3. **Deterministic participant ordering and winner selection**

The current safer-v1 work gets the system through step 1 and part of step 2.
The next major implementation milestone is the deterministic winner-selection and delivery flow.