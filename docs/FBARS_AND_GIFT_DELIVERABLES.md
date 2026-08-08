# FBARS and Gift Deliverables

This document explains two related parts of the current FreightOnNervos frontend/backend implementation:

1. how **FBARS** work today
2. how the new **gift deliverables** first-wave implementation works

It is written as an engineering reference for future changes.

---

## 1. What FBARS are

FBARS are the project’s application-level points / reputation / action-economy system.

They are:
- stored off-chain in MongoDB user profiles
- updated by server routes after wallet-authenticated actions
- tracked both as a lifetime balance and as a weekly state bucket

Core implementation lives in:
- [frontend/lib/fbars.ts](../frontend/lib/fbars.ts)
- [frontend/lib/mongodb.ts](../frontend/lib/mongodb.ts)

Mongo collections involved:
- `userProfiles`
- `fbarEvents`

Defined in:
- [frontend/lib/mongodb.ts](../frontend/lib/mongodb.ts#L35-L41)

---

## 2. FBARS data model

### User profile state

Each profile may contain:
- `fbars` → lifetime FBARS balance
- `weeklyFbarsState` → current weekly counters and derived totals
- `walletFbarsSeededAt`
- `walletFbarsSeedBalanceShannons`

Relevant types:
- `StoredFbarsProfile`
- `WeeklyFbarsState`

Defined in:
- [frontend/lib/fbars.ts](../frontend/lib/fbars.ts#L15-L31)

### Event log

Every FBARS change is recorded as an event with:
- `eventKey`
- `address`
- `weekKey`
- `kind`
- `delta`
- `metadata`
- `createdAt`

Relevant type:
- `FbarEventRecord`

Defined in:
- [frontend/lib/fbars.ts](../frontend/lib/fbars.ts#L33-L51)

This event log is important because it provides idempotency and auditability.

---

## 3. FBARS event kinds

Current event kinds are:
- `wallet-seed`
- `freight-create`
- `deposit`
- `interaction`
- `creator-winning-interaction`
- `creator-non-winning-interaction`
- `win`
- `marquee-edit`

Defined in:
- [frontend/lib/fbars.ts](../frontend/lib/fbars.ts#L33-L41)

### Meaning

- `wallet-seed`
  - one-time wallet-based seeding from on-chain balance
- `freight-create`
  - deducts FBARS when creating a freight
- `deposit`
  - awards FBARS when depositing CKB
- `interaction`
  - records like/comment/reshare/deposit interaction participation
- `creator-winning-interaction`
  - creator milestone counter for winning campaign types
- `creator-non-winning-interaction`
  - creator milestone counter for non-winning campaign types
- `win`
  - reward/win-side weekly progress
- `marquee-edit`
  - weekly marquee edit usage

---

## 4. Weekly FBARS state

Weekly state is keyed by the UTC week start date.

Functions:
- `getUtcCalendarWeekStart()`
- `getCurrentWeekKey()`

Defined in:
- [frontend/lib/fbars.ts](../frontend/lib/fbars.ts#L76-L86)

Each weekly state tracks:
- `total`
- `winCount`
- `interactionCount`
- `creatorWinningInteractionCount`
- `creatorNonWinningInteractionCount`
- `marqueeEditCount`

Normalization logic:
- `parseWeeklyFbarsState()`

Defined in:
- [frontend/lib/fbars.ts](../frontend/lib/fbars.ts#L118-L141)

---

## 5. FBARS constants and economics

Important constants:
- `FREIGHT_CREATION_FBARS_COST = 20`
- `WALLET_BALANCE_FBARS_DIVISOR_CKB = 1000n`
- `DEPOSIT_FBARS_DIVISOR_CKB = 1000n`
- `DEPOSIT_FBARS_MULTIPLIER = 2`
- `WEEKLY_INTERACTION_MILESTONE = 5`
- `WEEKLY_INTERACTION_MILESTONE_FBARS = 2`
- `WEEKLY_WIN_MILESTONE = 5`
- `WEEKLY_WIN_MILESTONE_FBARS = 10`
- `WEEKLY_MARQUEE_MAX_EDITS = 2`

Defined in:
- [frontend/lib/fbars.ts](../frontend/lib/fbars.ts#L5-L13)

### Current formulas

#### Wallet seed
```text
wallet_seed_fbars = floor(balance_shannons / (1000 CKB in shannons))
```

Implemented by:
- `computeWalletSeedFbars()`
- [frontend/lib/fbars.ts](../frontend/lib/fbars.ts#L158-L160)

#### Deposit award
```text
deposit_fbars = floor(amount_shannons / (1000 CKB in shannons)) * 2
```

Implemented by:
- `computeDepositFbars()`
- [frontend/lib/fbars.ts](../frontend/lib/fbars.ts#L162-L164)

#### Reward / win-side FBARS
```text
reward_fbars = floor(amount_shannons / (1000 CKB in shannons))
```

Implemented by:
- `computeRewardFbars()`
- [frontend/lib/fbars.ts](../frontend/lib/fbars.ts#L166-L168)

---

## 6. How FBARS are awarded safely

All FBARS mutations are funneled through:
- `awardFbarsEvent()`

Defined in:
- [frontend/lib/fbars.ts](../frontend/lib/fbars.ts#L174-L272)

### What it does

1. normalizes address
2. builds an `insertedEvent`
3. checks whether an event with the same `eventKey` already exists
4. if yes, returns `applied: false`
5. if no:
   - inserts the event into `fbarEvents`
   - updates the user’s profile totals and weekly state

### Why this matters

This makes FBARS **idempotent**.

If the same action is retried, replayed, or the client resubmits, the event key prevents double-awarding or double-deducting.

---

## 7. Where FBARS are triggered today

### 7.1 Wallet seed

Route:
- [frontend/app/api/user-profiles/seed/route.ts](../frontend/app/api/user-profiles/seed/route.ts)

Behavior:
- requires wallet nonce + signature
- verifies signer ownership of address
- reads live wallet balance
- computes seed FBARS with `computeWalletSeedFbars()`
- writes a `wallet-seed` event
- marks wallet as seeded in profile

### 7.2 Freight creation cost

Route:
- [frontend/app/api/fbars/freight-create/route.ts](../frontend/app/api/fbars/freight-create/route.ts)

Behavior:
- requires wallet nonce + signature
- checks current FBARS balance
- rejects if user has less than `20` FBARS
- writes a `freight-create` event with `delta = -20`

UI gate:
- [frontend/app/_components/CreateCampaignLauncher.tsx](../frontend/app/_components/CreateCampaignLauncher.tsx)

### 7.3 Deposit awards

Route:
- [frontend/app/api/fbars/deposit/route.ts](../frontend/app/api/fbars/deposit/route.ts)

Behavior:
- requires wallet nonce + signature
- checks the corresponding campaign record
- computes deposit FBARS
- writes:
  - a `deposit` event for the depositor
  - an `interaction` event for weekly interaction counting
  - a creator interaction event for the freight creator

Relevant code:
- [frontend/app/api/fbars/deposit/route.ts](../frontend/app/api/fbars/deposit/route.ts#L120-L191)

### 7.4 Social interactions

Route:
- [frontend/app/api/fbars/interaction/route.ts](../frontend/app/api/fbars/interaction/route.ts)

Supported actions:
- `like`
- `comment`
- `reshare`

Behavior:
- requires wallet nonce + signature
- ensures the social interaction is already persisted on the campaign record
- writes:
  - `interaction` event for the actor
  - creator interaction event for the campaign creator

Relevant code:
- [frontend/app/api/fbars/interaction/route.ts](../frontend/app/api/fbars/interaction/route.ts#L103-L200)

---

## 8. Winning vs non-winning campaign types

The FBARS system distinguishes between campaign types that count as “winning” versus “non-winning”.

Functions:
- `isWinningCampaignType()`
- `isNonWinningCampaignType()`

Defined in:
- [frontend/lib/fbars.ts](../frontend/lib/fbars.ts#L88-L97)

Current mapping:
- winning:
  - `Raffle`
  - `TimedChallenge`
  - `FundedTask`
- non-winning:
  - `SimpleTask`
  - `Crowdfunding`

This matters because creator interaction milestones are tracked separately for the two groups.

---

## 9. Wallet-authenticated write pattern used by FBARS and reused by gifts

The project uses a signed nonce model for sensitive off-chain writes.

Nonce route:
- [frontend/app/api/wallet/nonce/route.ts](../frontend/app/api/wallet/nonce/route.ts)

Signature verification:
- [frontend/lib/googleAuth.ts](../frontend/lib/googleAuth.ts)

### Pattern

1. client asks for nonce with a purpose string
2. server returns a purpose-bound nonce
3. wallet signs the nonce
4. client sends signed payload to server route
5. server verifies signature/address match with `verifyWalletSignature()`
6. server performs the mutation

This pattern is used by:
- wallet seed
- freight create cost
- deposit FBARS route
- social interaction FBARS route
- profile writes
- now also gift approval / claim / review flows

---

# Gift Deliverables — First-Wave Implementation

## 10. Goal

Gift deliverables let a creator make a freight that is targeted at tagged usernames using special directive markers inside the freight body.

The first wave implements:
- role parsing
- approval rules
- claim rules
- split configuration
- draft persistence
- review preview
- signed approval and claim endpoints

It does **not** yet implement payment streaming for `@receive`.

---

## 11. Supported directives and meaning

Special directive markers are:
- `@approve`
- `@claim`
- `@receive`

These are **section-based**.

That means the `@handles` following a directive belong to that directive until the next directive or the end of the text.

Example shape:
```text
#SimpleTask
Some gift freight text...

@approve @alice @bob
@claim @charlie @diana
@receive @eve
```

### First-wave behavior

- `@approve`
  - tagged users may approve before commencement
  - if nobody is tagged here, the freight can commence directly when the time gate is satisfied
- `@claim`
  - tagged users may claim after commencement
  - if nobody is tagged here, claim is open to anybody
- `@receive`
  - stored in metadata now
  - no streaming/payment behavior yet in first wave

---

## 12. Gift deliverable data model

The structured gift model lives in:
- [frontend/lib/giftDeliverables.ts](../frontend/lib/giftDeliverables.ts)

Main types:
- `GiftDeliverable`
- `GiftTaggedUser`
- `GiftRatioEntry`
- `GiftApprovalRule`
- `GiftApprovalRecord`
- `GiftPreviewSummary`

The campaign record now supports:
- `giftDeliverable?: GiftDeliverable | null`

Defined in:
- [frontend/app/_types/campaignRecords.ts](../frontend/app/_types/campaignRecords.ts)

### Stored fields

The structured record includes:
- `enabled`
- `approvalRule`
- `approvers`
- `claimants`
- `receivers`
- `splitMode`
- `ratioEntries`
- `commencementState`
- `requiredApprovalCount`
- `approvals`
- `commencedAt`

This lets the app evolve later without re-parsing everything from freeform description text every time.

---

## 13. Gift helper module responsibilities

Core helper file:
- [frontend/lib/giftDeliverables.ts](../frontend/lib/giftDeliverables.ts)

It currently provides:
- `parseGiftDirectiveSections()`
- `buildGiftMentionList()`
- `deriveRequiredApprovalCount()`
- `isGiftApprovalSatisfied()`
- `hasGiftStartTimeReached()`
- `isGiftClaimOpen()`
- `normalizeGiftTaggedUsers()`
- `normalizeGiftRatioEntries()`
- `buildGiftDeliverable()`
- `computeGiftPreviewAllocations()`
- `validateGiftConfiguration()`
- `parseStoredGiftDeliverable()`
- `stripGiftDirectiveMarkers()`

### Important architectural note

This helper was made **server-safe**.

It does **not** import `campaignDisplay.ts`, because that file pulls `@ckb-ccc/connector-react`, which caused `next build` to fail when API routes imported the gift helper transitively.

Instead, the gift helper now contains its own small formatting/normalization helpers for:
- CKB formatting
- `.ckb` handle formatting
- username normalization

This avoids client-only import leakage into route handlers.

---

## 14. Create flow integration

Primary create-flow file:
- [frontend/app/create/_components/CreateCampaignModalContent.tsx](../frontend/app/create/_components/CreateCampaignModalContent.tsx)

Validation helpers:
- [frontend/lib/campaignValidation.ts](../frontend/lib/campaignValidation.ts)

### What the create flow now does

It derives from description text:
- grouped approvers
- grouped claimants
- grouped receivers
- gift-enabled mode when a valid gift directive set appears on a `SimpleTask` or `TimedChallenge`

It also tracks new UI state such as:
- approval mode (`all` vs `threshold`)
- threshold count
- split mode (`equal` vs `ratio`)
- ratio entries
- resolved tagged addresses
- unresolved-handle warnings

### Review-step rules

The review step enforces:
- if claimants are explicit, split count auto-matches claimant count
- if no claimants are tagged, claim is open
- open-claim mode is equal-only in first wave
- ratio mode requires explicit tagged claimants
- threshold mode requires `0 < threshold < approver_count`

### Draft persistence

Draft records now round-trip `giftDeliverable` through:
- create payload construction
- save/retry paths
- draft reload
- draft snapshot comparisons

Routes involved:
- [frontend/app/api/campaign-records/route.ts](../frontend/app/api/campaign-records/route.ts)
- [frontend/app/api/campaign-records/[id]/route.ts](../frontend/app/api/campaign-records/%5Bid%5D/route.ts)
- [frontend/app/api/campaign-records/drafts/route.ts](../frontend/app/api/campaign-records/drafts/route.ts)

---

## 15. Gift runtime authorization model

Gift runtime actions are wallet-authenticated using the same signed nonce model as FBARS.

### Why

Handles are useful for authoring and UI, but wallet signatures are the actual authorization primitive.

### Resolution behavior

The app tries to resolve tagged handles to profile addresses using:
- [frontend/app/api/user-profiles/_lib/profileTarget.ts](../frontend/app/api/user-profiles/_lib/profileTarget.ts)
- [frontend/app/api/user-profiles/route.ts](../frontend/app/api/user-profiles/route.ts)

If a tagged handle cannot be resolved:
- publish is still allowed
- a warning is shown in the create flow
- runtime wallet-gated approval/claim behavior may not work until that handle maps to a profile

---

## 16. Gift approve endpoint

Route:
- [frontend/app/api/campaign-records/[id]/approve/route.ts](../frontend/app/api/campaign-records/%5Bid%5D/approve/route.ts)

### Current behavior

- requires wallet nonce + signature
- loads the campaign record
- parses `giftDeliverable`
- verifies that the caller is one of the tagged approvers (resolved by address)
- appends a unique approval record
- recomputes required approval count
- marks approval satisfaction and commencement state when threshold/all is met

### Important nuance

This first wave marks the gift approval state as logically commenced when approvals are satisfied, but full runtime claim opening still additionally checks the time gate through `isGiftClaimOpen()`.

So the actual claim condition is still:
- **approval gate satisfied**
- **scheduled start reached**

---

## 17. Gift claim endpoint

Route:
- [frontend/app/api/campaign-records/[id]/claim/route.ts](../frontend/app/api/campaign-records/%5Bid%5D/claim/route.ts)

### Current behavior

- requires wallet nonce + signature
- loads the campaign record
- verifies gift mode is enabled
- verifies the freight is claim-open using:
  - approval satisfaction
  - scheduled start reached
- if explicit claimants exist:
  - only a resolved tagged claimant may claim
- if no explicit claimants exist:
  - anybody may claim
- computes preview allocation data
- upserts a `campaignParticipants` record with gift-claim metadata

Stored participant metadata can include:
- `participantKind = "gift_claim"`
- `claimRole`
- `claimAmountShannons`
- `claimAmountLabel`
- `claimUnits`
- `claimSplitMode`

Participant route/schema file:
- [frontend/app/api/campaign-participants/route.ts](../frontend/app/api/campaign-participants/route.ts)

---

## 18. Gift review flow

Review route:
- [frontend/app/api/campaign-participants/[campaignId]/review/route.ts](../frontend/app/api/campaign-participants/%5BcampaignId%5D/review/route.ts)

### What changed

Originally this route trusted `reviewedByAddress` plus creator lookup.

It now also requires:
- `nonce`
- `nonceSignature`
- server-side wallet signature verification

This makes gift claim review match the project’s standard off-chain authenticated write pattern.

---

## 19. Runtime UI integration

Main runtime hook:
- [frontend/app/_hooks/useCampaignCardState.ts](../frontend/app/_hooks/useCampaignCardState.ts)

Current runtime additions include:
- parsing the record’s `giftDeliverable`
- computing claim preview allocations
- computing whether claims are open
- helper actions for:
  - gift approve
  - gift claim
  - gift info/modal display

Card-level UI:
- [frontend/app/_components/CampaignCard.tsx](../frontend/app/_components/CampaignCard.tsx)
- [frontend/app/_components/CampaignCardSurface.tsx](../frontend/app/_components/CampaignCardSurface.tsx)
- [frontend/app/_components/CampaignDetailSurface.tsx](../frontend/app/_components/CampaignDetailSurface.tsx)

### Current surfaced UI behavior

- feed cards can show gift metadata pills
- cards can expose:
  - gift details
  - approve
  - claim
- detail and feed surfaces strip structural gift markers from displayed body text using:
  - `stripGiftDirectiveMarkers()`

This prevents structural authoring tokens like `@approve` from polluting the display copy.

---

## 20. Shared modal reuse

The existing shared info modal system is reused instead of building a brand-new modal stack.

Main files:
- [frontend/app/_components/AppShellHeader.tsx](../frontend/app/_components/AppShellHeader.tsx)
- [frontend/app/_components/FreightInfoModal.tsx](../frontend/app/_components/FreightInfoModal.tsx)
- [frontend/app/page.tsx](../frontend/app/page.tsx)

The implementation currently reuses the same settlement-style information channel (`SettlementModalData`) to surface gift detail payloads, with an optional `gift` block added to the modal data type.

Type updated in:
- [frontend/app/_types/settlement.ts](../frontend/app/_types/settlement.ts)

This works as a first pass, but a future cleanup may want to introduce a dedicated gift modal mode and dedicated gift-modal body renderer.

---

## 21. Build issue encountered and resolved

During implementation, `next build` failed on the new approve route with a server/runtime error like:

```text
TypeError: ... createContext is not a function
```

Route affected:
- `/api/campaign-records/[id]/approve`

### Root cause

The new gift helper module originally imported `campaignDisplay.ts`, which imports `@ckb-ccc/connector-react`.
That pulled client/runtime code into a server route dependency graph.

### Fix

`giftDeliverables.ts` was refactored to be server-safe and no longer depends on `campaignDisplay.ts`.
It now owns its own minimal helper functions for:
- CKB formatting
- username normalization
- `.ckb` handle formatting

After that fix:
- `npx tsc --noEmit` passed
- `npm run build` passed

---

## 22. Current limitations of the first-wave gift implementation

This is an intentionally scoped first wave.

### Not yet implemented / incomplete

- `@receive` streaming behavior is not implemented yet
- gift details currently reuse settlement-style modal plumbing instead of a dedicated gift modal mode
- runtime UI is integrated but still not fully polished as a dedicated gift experience
- unresolved handle publishing is allowed, which is flexible, but runtime wallet-based enforcement depends on actual address resolution
- claim payout/distribution is still an off-chain coordination layer, not a fully on-chain gift settlement primitive

---

## 23. Suggested next steps

If work continues on this feature, the next logical steps are:

1. **Dedicated gift modal mode**
   - separate from raffle settlement presentation
2. **More detailed detail-page gift UI**
   - approval progress
   - split display
   - claimant list
3. **Streaming implementation for `@receive`**
   - likely new runtime/state model
4. **More explicit payout settlement path**
   - if claims need on-chain or finalized accounting behavior
5. **Potential FBARS integration for gift approvals/claims**
   - only if product wants approve/claim actions to affect reputation/economy

---

## 24. Summary

### FBARS today
- are an off-chain, event-sourced points system
- use weekly counters + lifetime balance
- are awarded/deducted by wallet-authenticated API routes
- rely on idempotent `eventKey`-based writes

### Gift deliverables today
- are a first-wave off-chain orchestration layer on top of existing `SimpleTask` / `TimedChallenge` freights
- use structured `giftDeliverable` metadata on campaign records
- parse `@approve`, `@claim`, and `@receive` directives from freight text
- support creator-configured approval rules and split modes
- use signed nonces for approve / claim / review security
- persist and preview split behavior in drafts and review flow
- currently treat `@receive` as future-facing metadata only

---

## 25. Reference file index

### FBARS
- [frontend/lib/fbars.ts](../frontend/lib/fbars.ts)
- [frontend/lib/mongodb.ts](../frontend/lib/mongodb.ts)
- [frontend/app/api/user-profiles/seed/route.ts](../frontend/app/api/user-profiles/seed/route.ts)
- [frontend/app/api/fbars/freight-create/route.ts](../frontend/app/api/fbars/freight-create/route.ts)
- [frontend/app/api/fbars/deposit/route.ts](../frontend/app/api/fbars/deposit/route.ts)
- [frontend/app/api/fbars/interaction/route.ts](../frontend/app/api/fbars/interaction/route.ts)
- [frontend/app/api/wallet/nonce/route.ts](../frontend/app/api/wallet/nonce/route.ts)
- [frontend/lib/googleAuth.ts](../frontend/lib/googleAuth.ts)

### Gift deliverables
- [frontend/lib/giftDeliverables.ts](../frontend/lib/giftDeliverables.ts)
- [frontend/lib/campaignValidation.ts](../frontend/lib/campaignValidation.ts)
- [frontend/app/_types/campaignRecords.ts](../frontend/app/_types/campaignRecords.ts)
- [frontend/app/api/campaign-records/route.ts](../frontend/app/api/campaign-records/route.ts)
- [frontend/app/api/campaign-records/[id]/route.ts](../frontend/app/api/campaign-records/%5Bid%5D/route.ts)
- [frontend/app/api/campaign-records/drafts/route.ts](../frontend/app/api/campaign-records/drafts/route.ts)
- [frontend/app/api/campaign-records/[id]/approve/route.ts](../frontend/app/api/campaign-records/%5Bid%5D/approve/route.ts)
- [frontend/app/api/campaign-records/[id]/claim/route.ts](../frontend/app/api/campaign-records/%5Bid%5D/claim/route.ts)
- [frontend/app/api/campaign-participants/route.ts](../frontend/app/api/campaign-participants/route.ts)
- [frontend/app/api/campaign-participants/[campaignId]/review/route.ts](../frontend/app/api/campaign-participants/%5BcampaignId%5D/review/route.ts)
- [frontend/app/create/_components/CreateCampaignModalContent.tsx](../frontend/app/create/_components/CreateCampaignModalContent.tsx)
- [frontend/app/_hooks/useCampaignCardState.ts](../frontend/app/_hooks/useCampaignCardState.ts)
- [frontend/app/_components/CampaignCard.tsx](../frontend/app/_components/CampaignCard.tsx)
- [frontend/app/_components/CampaignCardSurface.tsx](../frontend/app/_components/CampaignCardSurface.tsx)
- [frontend/app/_components/CampaignDetailSurface.tsx](../frontend/app/_components/CampaignDetailSurface.tsx)
- [frontend/app/_types/settlement.ts](../frontend/app/_types/settlement.ts)
