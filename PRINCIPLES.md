# FON Principles

## Context

In FON, a mounted app does not directly tell a freight whether someone is "valid" in a hardcoded way. Instead, the mounted app exposes **principles** that FON can mount, query, and track per participant.

A principle is best understood as an **app-owned predicate**:
- the app defines it
- the freight creator selects it
- FON evaluates it against a participant
- the result tells FON whether that participant satisfies that rule

This keeps the app in control of its own game, leaderboard, or external logic, while still letting FON reason about eligibility in a standard way.

---

## Core idea

A principle should be:
- **stable by id**
- **parameterized by inputs**
- **human-readable**
- **evaluated by the app**
- **returned as more than a bare boolean**

The biggest design rule is:

> Put variable behavior in **params**, not in the principle id.

So instead of proliferating ids like:
- `participant_played_10_times`
- `participant_ranked_top_20_current`
- `participant_ranked_top_20_all_time`

prefer a stable principle id such as:
- `participant-play-count`
- `participant-rank-range`

and then pass the variable parts as params.

---

## Examples

### 1. Play-count principle

Principle id:
- `participant-play-count`

Params:
- `minPlays`
- optionally `scope`

Readable examples:
- "Play at least 10 times"
- "Play at least 10 times during this freight"

### 2. Leaderboard rank range

Principle id:
- `participant-rank-range`

Params:
- `minRank`
- `maxRank`
- `scope`

Readable examples:
- "Rank between #1 and #20"
- "Rank between #1 and #20 during this freight"

### 3. Presence on leaderboard

Principle id:
- `participant-on-leaderboard`

Params:
- `scope`

Readable examples:
- "Appear on the leaderboard"
- "Appear on the leaderboard during this freight"

### 4. Score threshold

Principle id:
- `participant-score-at-least`

Params:
- `minScore`
- `scope`

Readable examples:
- "Reach a score of at least 5000"

---

## What a principle should return

A principle should not return only `true` or `false`.

It should return something like:

```ts
{
  fulfilled: boolean;
  detail?: string;
  updatedAt?: string;
}
```

Why this matters:
- `fulfilled` tells FON the result
- `detail` gives a participant or creator a human explanation
- `updatedAt` helps FON reason about freshness and history

Examples:
- `fulfilled: false, detail: "Played 14 times; needed 20"`
- `fulfilled: true, detail: "Current rank is #7 within required range #1-#10"`

---

## What a principle definition should include

A useful principle definition should contain more than just `id` and `title`.

At minimum it should have:
- `principleId`
- `title`
- `description`
- `supportsTimestampQuery`
- `paramsSchema`
- `paramsDefaults`
- some readable formatting guidance

Why:
- FON needs to know what inputs a creator must supply
- FON needs to know how to render those inputs later
- FON needs to know whether the app can answer as-of / historical queries
- creators and participants need readable text, not raw ids

---

## Timeframe should be context, not a new id

A frequent mistake is to encode timeframe into the principle id, such as:
- `participant-rank-range-current`
- `participant-rank-range-all-time`

That should instead be expressed as:
- params, such as `scope: "current-freight-window"`
- or evaluation context, such as freight `startsAt`, `endsAt`, and `asOf`

This keeps the principle vocabulary clean and extensible.

---

## Creator flow

The intended creator flow is:
1. a hosted app registers with FON
2. the hosted app exposes a list of principles
3. a freight creator mounts that app on a freight
4. the creator selects a subset of those principles
5. the creator configures params for those selected principles
6. FON stores those selected principle configs on the freight

So the creator is not inventing principles. They are selecting from the app's exposed principle surface.

---

## Participant flow

The intended participant flow is:
1. a participant engages with the freight
2. the mounted app observes or evaluates the participant's activity
3. FON receives or requests principle states
4. each selected principle becomes fulfilled or unfulfilled
5. when the selected mounted principles are all satisfied, the mounted app portion of participant eligibility is satisfied

---

## Push vs pull

There are two valid models for principle evaluation.

### Push model
The hosted app computes principle states itself and sends updates into FON.

This matches the current repo most closely.

### Pull model
FON asks the hosted app to evaluate principles for a participant and receives the result on demand.

This is especially attractive for game and leaderboard apps because:
- leaderboard state lives in the app
- FON can query when needed
- freight windows and as-of queries are easier to express
- the app does not need to proactively push every state change

A healthy long-term design can support both:
- **push** for proactive updates
- **pull** for precise evaluation queries

---

## SDK shape guidance

An ideal app-side API should look conceptually like this:

```ts
.addPrinciple("participant-rank-range", "Rank within range")
.evaluatePrinciple("participant-rank-range", {
  minRank: 1,
  maxRank: 10,
  scope: "current-freight-window",
})
```

But in practice the principle definition needs richer metadata than that shorthand suggests.

The important point is that:
- the **app defines** the principle
- the **creator selects** it
- **FON evaluates** it against participant + freight context
- the result is normalized into FON's mounted-app state model

---

## Bottom line

The strongest version of the principle system is:

> A principle is a typed, parameterized, app-owned predicate that FON can mount and evaluate against a participant in a freight context, returning both a boolean-style result and a human-readable explanation.

That gives FON a durable contract for games, leaderboards, forms, and future external apps without hardcoding app-specific logic into the freight system.
