# NDAO Raffle Mountable Concept

## Overview

This document describes a possible Freight on Nervos mountable built around NervosDAO yield, iCKB liquidity, and a transparent raffle mechanic.

The core idea is simple:

- users deposit DAO-backed funds through an iCKB-compatible flow
- the underlying DAO yield is pooled for a raffle round
- users receive raffle tickets based on deposit size
- prizes are paid from pooled yield rather than from hidden principal loss
- after each round, users can choose to exit or stay for the next round

This is not ordinary DAO staking. It must be presented honestly as a voluntary trade:

> instead of taking a small direct yield payout, the user chooses to pool that yield for a chance at a larger prize.

---

## Why this exists

NervosDAO offers a relatively low-risk yield source, but direct DAO participation is illiquid because withdrawals require a waiting period.

iCKB helps make DAO-backed value more usable. That makes it possible to build more flexible products on top of DAO participation.

Freight can use that composability to offer a mountable raffle experience that is:

- transparent
- opt-in
- round-based
- flexible across multiple campaign types

---

## The role of Freight

Freight should not try to become NervosDAO or replace iCKB.

Freight's role is to provide the product and campaign layer:

- entry flow
- participant registration
- raffle round management
- ticket accounting
- prize display and settlement rules
- exit-or-stay decisions between rounds
- campaign-level presentation and consent

The DAO/iCKB layer remains the yield and liquidity layer underneath.

---

## The role of iCKB

iCKB is the usability layer that makes DAO-backed positions more liquid and composable.

In this concept:

- NervosDAO is the source of yield
- iCKB is the liquid representation or access layer around DAO-backed value
- Freight is the experience layer
- the raffle is the reward distribution mechanic built on top

Without iCKB, a DAO raffle product would be much more rigid and harder for users to enter and leave cleanly.

---

## Core product principle: no deception

Users must know exactly what they are doing.

The UI and rules should clearly explain:

- they are entering a raffle backed by DAO-generated yield
- their yield is being pooled into a round prize pool
- ticket count depends on deposit amount if stake-weighted tickets are used
- winning is probabilistic, not guaranteed
- their principal is still subject to DAO/iCKB mechanics
- they will be given a choice after each round to exit or stay

This product should never be described as ordinary DAO deposit behavior if yield redirection is part of the design.

---

## Proposed raffle model

### 1. Entry

Any eligible user can join a raffle round by depositing DAO-backed funds through the supported flow.

Possible UX framing:

- deposit CKB into the DAO-backed raffle pool
- receive ticket weight based on deposit size
- join the active round

### 2. Ticket calculation

The more a user deposits, the more tickets they receive.

Example models:

- 100 CKB = 1 ticket
- 500 CKB = 5 tickets
- 1000 CKB = 10 tickets

The exact formula should be fixed and shown before deposit confirmation.

### 3. Yield accrual

During the round, DAO-backed yield accrues.

That yield becomes the prize pool for the round, subject to any explicit platform fee or reserve rules.

### 4. Round settlement

At the end of the round:

- the round closes
- final eligible tickets are counted
- winners are drawn according to the published rules
- prizes are distributed from accrued yield

### 5. Exit or stay

After round settlement, each user chooses one of two actions:

- **Exit**: leave the raffle after the completed round
- **Stay**: keep participating in the next round with their eligible balance

This makes the system easier to understand and prevents users from feeling locked into an indefinite raffle.

---

## Round-based lifecycle

Each raffle should be treated as a series of explicit rounds.

Each round should have:

- round id
- start time
- end time
- total eligible deposits
- total tickets
- prize pool amount
- winner count
- winner selection result
- per-user post-round state: exit or stay

This round structure is important for both trust and implementation simplicity.

---

## Winner count tapering

One possible mechanic is to reduce `no_of_winners` over time until the raffle fully winds down.

Example:

- round 1: 20 winners
- round 2: 10 winners
- round 3: 5 winners
- round 4: 2 winners
- round 5: 1 winner

This can create a progressive structure, but it must be extremely clear in the rules because shrinking winner counts change the risk/reward profile over time.

Alternative approach:

- keep winner count fixed per round
- let the participant set naturally shrink as users choose to exit

This simpler model may be easier to explain at first.

---

## Mountable interpretation in Freight

This concept fits naturally as a Freight mountable.

A campaign could attach an `NDAO raffle` mountable that defines:

- deposit rules
- round duration
- ticket formula
- winner count or taper schedule
- prize calculation rules
- exit/stay behavior
- eligibility constraints
- disclosure copy

This would let Freight campaigns reuse the raffle system without turning every campaign into custom logic.

---

## Transparency requirements

Before a user joins, the product should display:

- what asset is being deposited
- whether the deposit is DAO-backed directly or via iCKB
- how tickets are calculated
- how the prize pool is generated
- whether all yield or only part of yield is used
- how many winners the current round will have
- what happens if the user exits after the round
- what happens if the user stays
- any fees or reserves taken before distribution

Clear language matters more here than clever design.

---

## Example plain-language copy

> Deposit into a DAO-backed raffle pool. Instead of receiving your yield directly, your yield joins the round prize pool. Your deposit size determines how many raffle tickets you get. At the end of the round, winners are selected. After that, you can either exit or keep your balance in for the next round.

---

## Key product decisions still open

1. Is user principal always fully redeemable, subject only to DAO/iCKB timing?
2. Is 100% of generated yield used for prizes, or only a portion?
3. Can a winning user stay in later rounds, or are winners automatically removed?
4. Is ticketing purely linear by deposit size, or does it use brackets/caps?
5. Does the winner count shrink across rounds, or stay fixed?
6. Is this a standalone mountable or a subtype of a broader yield/financial mountable framework?

---

## Recommended first implementation shape

For a real and fast first version, keep it simple:

- one active raffle round at a time
- fixed round duration
- fixed ticket formula
- fixed number of winners per round
- explicit post-round exit/stay choice
- clear yield-pool disclosure
- no hidden mechanics

This keeps the first version understandable and testable while preserving the main concept.

---

## Summary

The NDAO raffle mountable is a transparent, opt-in, round-based raffle built on DAO-generated yield and enabled by iCKB composability.

Its defining principle is honesty:

- users are not just staking normally
- they are choosing to pool yield for a chance at a larger prize
- they can decide after each round whether to leave or continue

That makes it a distinct product mechanic, not just a renamed DAO deposit flow.
