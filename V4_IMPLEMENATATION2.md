# V4 Implementation 2 — `#Stocks` as Prediction Markets

## Overview
For a post like:

> **Will Messi score two goals today?**

with hashtag `#Stocks`, the cleanest implementation is not true equity stock trading, but a **binary prediction market**.

Users take positions on one of two outcomes:

- **YES** — Messi scores 2+ goals
- **NO** — Messi does not

In product language:

- **Long** = buy **YES** shares
- **Short** = buy **NO** shares

This avoids the complexity of true short-selling while preserving the same intuition for users.

---

## Core settlement logic
Each share resolves to a fixed payout at the end:

- if **YES** happens:
  - YES share = `1`
  - NO share = `0`
- if **NO** happens:
  - YES share = `0`
  - NO share = `1`

So the user’s profit or loss comes from:

**Profit = settlement value (or resale value) - purchase price**

---

## Example
### Long YES
- user buys YES at `0.40`
- event resolves YES
- payout = `1.00`
- profit = `1.00 - 0.40 = 0.60`

If the market resolves NO instead:
- payout = `0`
- loss = `0.40`

### “Short” via buying NO
- user buys NO at `0.55`
- event resolves NO
- payout = `1.00`
- profit = `0.45`

So in a simple implementation:
- **long** = buy YES
- **short** = buy NO

---

## Where winner profits come from
The winner is paid from **collateral contributed into the market**.

A YES and NO share together represent a fully collateralized pair that settles to `1` in total.

Example:
- Alice buys YES at `0.40`
- Bob buys NO at `0.60`
- combined collateral = `1.00`

At resolution:
- one side gets `1.00`
- the other gets `0`

So losers’ stake funds winners.

---

## Three possible constructions

### 1. Order book model
Users post bids and asks for YES and NO shares.

#### Pros
- familiar trading model
- natural buy/sell pricing
- transparent matching

#### Cons
- needs counterparties
- harder UX for casual/social users

This works well if you want something that feels closest to trading.

---

### 2. AMM / automated market maker
Instead of matching users directly, the app uses a pricing engine.

As more users buy YES:
- YES price rises
- NO price falls

As more users buy NO:
- NO price rises
- YES price falls

#### Pros
- users can always trade
- smooth social UX
- no waiting for counterparties

#### Cons
- more complex pricing logic
- requires careful market design

This is often the best fit for a product-first experience.

---

### 3. Pari-mutuel pool
All money goes into one shared pool.

At resolution:
- winners split the total pool pro rata

Example:
- YES pool = `30`
- NO pool = `70`
- total = `100`
- outcome = YES

If a user put `3` into YES, and total YES pool was `30`:
- user owns 10% of the winning side
- payout = 10% of 100 = `10`
- profit = `7`

#### Pros
- easiest conceptually
- easy to explain

#### Cons
- weaker “trading price” feel
- less stock-like unless extended

---

## Recommended v1 for FreightOnNervos
### Recommendation
Implement `#Stocks` posts as **fully collateralized binary prediction markets**.

Users can:
- **Buy YES**
- **Buy NO**
- **Sell their position before resolution**

Users should **not** be allowed to do true borrowing-based short selling in v1.

### Why
This gives:
- clear profit/loss logic
- simple UX
- strong social/speculative feel
- no margin/liquidation complexity
- easier resolution and accounting

---

## “Sell” in v1
There are two interpretations of selling:

### A. Sell to close
User already owns shares and sells them later.

Example:
- buy YES at `0.40`
- later sell YES at `0.65`
- profit = `0.25`

This is the preferred meaning of **sell** in v1.

### B. True short sell
User borrows shares, sells first, then buys back later.

This requires:
- borrowing
- margin
- liquidation rules
- collateral management

This should **not** be included in v1.

---

## Resolution flow
Each `#Stocks` post should include:
- market question
- close time
- resolution time
- binary outcomes: YES / NO
- trusted resolution authority or oracle path

At resolution:
- market settles to YES or NO
- winning shares redeem at `1`
- losing shares redeem at `0`

---

## Price as probability
The market price can be interpreted as implied probability.

Example:
- YES price = `0.40`
- market implies ~40% probability YES occurs

If later the price becomes `0.75`, early YES buyers gain on paper and may sell before resolution.

This is the mechanic that makes prediction markets feel “stock-like.”

---

## Suggested product language
Even if the hashtag remains `#Stocks`, the actual UI terminology should be clearer:

- **Buy YES**
- **Buy NO**
- **Sell Position**
- **Long** / **Short**
- **Chance** / **Price** / **Payout**

That keeps the product intuitive while avoiding confusion with real equity ownership.

---

## Summary recommendation
For FreightOnNervos, the strongest first implementation is:

- binary market posts under `#Stocks`
- fully collateralized positions
- YES / NO buying
- sell-to-close support
- fixed 1/0 resolution payout
- no true short borrowing
- no leverage

This gives a social prediction market with simple profit/loss behavior and a clean path to future expansion.
