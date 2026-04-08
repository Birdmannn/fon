# FreightOnNervos — Contract & Frontend Changelog

## Contract Changes

### New Types (`types.rs`)

- `CampaignType::Raffle = 4` — ticket-based raffle campaign
- `Campaign.aux_amount: u64` — stores ticket price for Raffle campaigns, 0 otherwise
- `Campaign.summary: [u8; 64]` — UTF-8 zero-padded campaign description (set at creation, never changed)
- `ParticipantData.deposited_amount: u64` — tracks how much each participant deposited (needed for refunds)
- `ParticipantStatus::Refunded = 3` — new terminal status for refunded participants
- `CAMPAIGN_DATA_LEN`: 102 → 174 bytes
- `PARTICIPANT_DATA_LEN`: 65 → 73 bytes

### Updated Instructions

**`create_campaign` (selector 0)**
- Args extended: `[start(8)][task(8)][type(1)][max(8)][aux(8)]` = 33 bytes (was 25)
- Validates `summary` is non-empty (not all zeros)
- For `Raffle` type: validates `maximum_amount % aux_amount == 0` and `aux_amount > 0`

**`deposit` (selector 1)**
- Unchanged in logic; now works with 174-byte campaign cells

**`verify_participant` (selector 3)**
- Raffle path: no admin signature required; validates ticket price capacity transfer via `apply_deposit`, then calls `validate_participant_added` with `ticket_price` as `deposited_amount`
- Non-raffle path: unchanged (admin ECDSA signature in `witness.input_type`)
- Both paths: output participant cell must have `status = Verified` and correct `deposited_amount`

**`update_campaign_status` (selector 4)**
- Fully implemented (was a stub)
- Permissionless: anyone can call it
- `Created → Active` when `now >= created_at + start_duration * 1000`
- `Active → Completed` when `now >= created_at + (start_duration + task_duration) * 1000`
- Only forward transitions allowed; returns `InvalidOperation` if nothing to update yet

**`submit_randomness_hash` (selector 5)**
- Unchanged

### New Instructions

**`cancel_campaign` (selector 6)**
- Caller must be the campaign creator (verified via non-campaign input lock vs `campaign.created_by`)
- Campaign must not already be `Completed` or `Cancelled`
- Output cell: identical data with `status = Cancelled`

**`refund` (selector 7)**
- Campaign must be `Cancelled`
- Caller must be the campaign creator
- For each `Verified` participant input: validates `campaign_tx_hash` and `campaign_index` match, output participant has `status = Refunded`, output capacity = input capacity + `deposited_amount`
- Output campaign cell: `current_deposits` reduced by total refunded amount
- Works for all campaign types

### New Helpers

- `apply_deposit(campaign, amount)` in `utils.rs` — shared capacity transition logic used by both `deposit` and the raffle path of `verify_participant`
- `validate_refund_outputs` / `validate_refunded_output` in `validations.rs` — validates all participant refund transitions in a batch
- `validate_participant_added` now takes `deposited_amount` parameter and verifies it matches the output cell

---

## Frontend Changes

- `CampaignData` interface: added `auxAmount`, `summary` fields; size 166 → 174 bytes
- `ParticipantData` interface: added `depositedAmount` field; size 65 → 73 bytes
- `ParticipantStatus`: added `Refunded = 3`
- `CampaignType`: added `Raffle = 4`
- `Selector`: added `CancelCampaign = 6`, `Refund = 7`
- `encodeCreateCampaignArgs`: added `auxAmount` parameter
- `encodeSummary` / `decodeSummary` helpers added
- Create campaign page: added `summary` text input (required, 64-byte limit with live counter) and conditional `Ticket Price` field shown only for Raffle type

---

## Tests (29 total, all passing)

| Test | What it covers |
|------|---------------|
| `test_create_campaign_success` | Basic campaign creation |
| `test_create_campaign_empty_summary_rejected` | Empty summary blocked |
| `test_create_raffle_campaign_success` | Raffle creation with valid ticket price |
| `test_create_raffle_invalid_ticket_price_rejected` | Non-divisible ticket price blocked |
| `test_deposit_success` | Normal deposit flow |
| `test_deposit_exceeds_maximum_caps_to_remaining` | Partial deposit capping |
| `test_deposit_rejects_simple_task` | SimpleTask deposits blocked |
| `test_deposit_within_start_period_millisecond_timestamps` | ms timestamp regression |
| `test_deposit_rejects_after_start_period_elapsed` | Late deposit blocked |
| `test_verify_participant_campaign_expired` | Expired campaign blocked |
| `test_verify_participant_invalid_signature` | Bad signature blocked |
| `test_verify_participant_success` | Valid admin signature accepted |
| `test_verify_participant_raffle_success` | Raffle entry without signature |
| `test_batch_deliver_sequential` | Equal split delivery |
| `test_batch_deliver_randomness_success` | Randomness preimage delivery |
| `test_batch_deliver_wrong_preimage` | Wrong preimage blocked |
| `test_batch_deliver_deadline_not_passed` | Early delivery blocked |
| `test_submit_randomness_hash_success` | Commit distribution params |
| `test_submit_randomness_hash_already_set` | Idempotency guard |
| `test_submit_randomness_hash_campaign_cancelled` | Cancelled campaign blocked |
| `test_cancel_campaign_success` | Creator cancels campaign |
| `test_cancel_campaign_already_cancelled` | Double-cancel blocked |
| `test_cancel_campaign_unauthorized` | Non-creator cancel blocked |
| `test_refund_success` | Two participants refunded correctly |
| `test_refund_campaign_not_cancelled` | Refund on active campaign blocked |
| `test_refund_wrong_output_capacity` | Insufficient refund blocked |
| `test_update_campaign_status_to_active` | Created → Active transition |
| `test_update_campaign_status_to_completed` | Active → Completed transition |
| `test_update_campaign_status_too_early` | Premature update blocked |
