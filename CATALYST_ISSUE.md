# Freight on Nervos (FON): a CKB-native deliverables network, open for feedback

## Project Summary

Freight on Nervos (FON) is a social application for creating, funding, participating in, and delivering "freights": work, gifts, and raffles with explicit rules for who may participate and when value can be released. **Every proposed transaction can be a deliverable.** A freight can be a simple post that someone tips, a funded task with a defined recipient, a giveaway with verifiable winner selection, or a task whose eligibility depends on actions in another app.

The aim is to let a creator state the work and its conditions, let other people contribute funds or participate, and make the important money-moving rules enforceable by a CKB script. The social layer and external-app verification live in FON's web application; they are not presented as on-chain facts when they are not. This is a live testnet demo, not a claim that every edge case is finished or audited.

## Tools Used

- **CKB and Rust:** a freight type script for campaign state, escrow transitions, raffle settlement, approvals, and gift-claim rules.
- **CCC and JoyID:** wallet connection and signing; the Checkbox Demo also uses JoyID so its activity belongs to a connected CKB address.
- **Next.js, React, and TypeScript:** the FON interface, API, SDK integration, and separately deployed demo app.
- **MongoDB:** profiles, freight metadata, registered mountable apps, off-chain participation and completion, and demo state.
- **FON SDK and webhooks:** the server-side integration surface through which hosted apps register principles and exchange freight events.

## Current Features

### Freights, funding, and tipping

FON has simple tasks, funded tasks/gifts, crowdfunding and timed-challenge types, ordinary raffles, and recurring raffles. Creators can write a post, add images, set the relevant timing and funding arguments, attach conditions, save a draft, preview it, and publish through their wallet. Participants can discover the freight from the feed or profiles, inspect its conditions, and take the actions appropriate to its type.

**Tipping is available on ordinary freights.** A simple task can serve as a continuing piece of work or a creator's open-ended post: it displays as ongoing rather than expiring like a timed raffle. A supporter can send CKB as appreciation; for simple tasks, the tip transaction pays the creator's wallet directly and records the support on the freight. Other freight types can accept deposits into their campaign balance, subject to their state and rules. That distinction matters: a direct creator tip is not a promise that the supporter has bought a raffle ticket or acquired a claim on escrow.

**Funded gifts and claims** let a creator describe a deliverable and fund an allocation for eligible claimants. The current gift policy fixes claim slots and amounts at creation, supports open or tagged claimants and equal or ratio-based splits, and pays a claimant through a wallet-signed on-chain transaction. The contract checks the claimant and available escrow, rather than treating an editable database record as payment authority. Funding and delivery can also be subject to an approval gate. This can model a funded proposal: contributors provide the resources, a creator performs the work, and named inspectors approve commencement before claims or release proceed. The recipient may be designated with `@claim`; unsupported streaming through `@receive` is deliberately not presented as a working feature.

### Raffles and verifiable selection

In an **ordinary raffle**, users obtain tickets during the entry window. Paid tickets fund the raffle pool; free-entry raffles need other funding. Voluntary support deposits can also contribute a creator-selected percentage to the winners' pool, with the remainder kept separate for creator withdrawal under the freight's rules. A purchase can contain multiple tickets, each represented as a separate participant entry and therefore another chance in the draw. The creator sets the number of winners and a tickets-per-wallet limit. The app checks prior entries before allowing another purchase, while the current contract enforces the ticket quantity per transaction; whether the cumulative wallet limit should also be enforced on-chain is an important review question. If eligible participant entries do not exceed the winner count, everyone can win; otherwise the winning entries must be selected.

The randomness path uses **commit, reveal, and deterministic selection**. The creator commits a hash of a secret value when creating the raffle. At settlement, the preimage is revealed and the contract verifies that its Blake2b hash matches the stored commitment. Eligible participant cells are put in a canonical order using join time, address, and input outpoint as tie-breakers. The revealed value, campaign identity, and participant count derive a seed; a deterministic Fisher-Yates shuffle with rejection sampling selects the first required entries. The contract checks the proposed winner outputs and equal per-winner amount against that result. This gives reviewers concrete inputs to reproduce and challenge a draw; it does **not** remove the need to examine creator withholding of the reveal, ticket accounting, or the complete settlement UX.

**Recurring raffles** turn one raffle into rounds. Participants buy into an active round; when it closes, an on-chain draw marks winners and non-winners without immediately paying everybody. The freight enters a creator-configured sleep period. Winners can cash out during that window; non-winners are eliminated from that round. When sleep ends, unclaimed value remains in the pool, the next winner count is reduced by the configured percentage (never below one), and a new round starts. New or previous users can buy tickets for that next round as new entries. The process ends when a round has one winner, whether that winner cashes out during sleep or the final round closes. The round number, winner count, claimable amounts, pool, and transitions are represented in campaign/participant state and checked by the contract. It is a different product from a one-shot giveaway: each sleep period is a real choice between taking a known claim and continuing the competition.

This recurring flow is **implemented and its automated tests pass**, but it has not been established as error-free in real use. Meaningful end-to-end testing needs more independent participants and wallets across several rounds, especially around cash-out, non-claims, and rollover. So far I have been testing mostly alone with at most three wallets, which also means juggling three browser sessions; I have not had enough test users to exercise it at realistic scale. I would particularly welcome people willing to test these transitions and report failures.

### Mountables: freight conditions and delivery signals

**All freight constraints are treated as mountables, but not all mountables are constraints.** Some built-in mounted signals describe how a freight behaves, such as being rewardable or requiring a signature; others actively gate participation or completion. A creator can select multiple conditions, and all required conditions must be satisfied before FON marks the same wallet canonically complete. This creates a useful exchange: the creator can narrow eligibility to people who performed the requested work, while participants can demonstrate that work and compete for or claim the associated value. On a funded freight, additional supporters can contribute to the pool without needing to be the original creator.

The main extensibility point is a **mounted app**. Any hosted app can use the FON SDK to register its logo, endpoints, and a catalogue of principles. Each principle has a title, explanation, parameter schema, and a true/false evaluation for a participant. For example, a reputation app could expose `reputation-greater-than` with a numeric parameter. A creator could mount it with `10000`, making a reputation above that number one of the freight's required conditions. That is an illustration of the SDK, not a claim that this particular reputation app is already integrated. The live Checkbox Demo instead exposes checkbox, checkbox-count, checkbox-set, and exact-text principles. A creator can set the exact word; a participant must enter that word in the demo to satisfy the selected principle.

Registration is app-level, not per freight. At setup, FON asks the hosted app to verify the selected principle configuration. After publication gives the freight its final ID, FON sends an authenticated `mount.requested` webhook containing that ID, selected principles and parameters, start/end times, duration in seconds, FON's event URL, and a **freight-scoped secret**. The app may push participant states during that window; FON rejects updates outside it and recalculates completion. An optional polling fallback exists, but is disabled by default and needs a separately configured worker. The app-registration secret and each freight's expiring event secret serve different purposes, and neither belongs in browser code.

**FBARS locks** are a built-in participation condition. FBARS are FON's current participation/reputation points, awarded for qualifying wallet, funding, social, and reward activity; they are not yet a mintable token. A creator can block participants *below* a chosen FBARS threshold or block those *at or above* it. Someone with at least **5 times the creator's current FBARS** can bypass that lock. This deliberately lets a creator target a particular participation band without making the lock absolute against a substantially more established account. FBARS also drive weekly/overall rankings; the weekly leader can edit the public marquee within a limited weekly allowance.

**Child Freight** is another built-in condition. A creator can require a participant to publish a direct child freight, optionally with a specified title, before the original freight counts that participant as complete. Separately, published freights can be linked for tracking without making the link a completion requirement. A future lightweight "ref" is intended to make that reference-only use even clearer in the UI.

**Parent and child relationships** give freights a dependency graph. A child can have multiple direct parents; the same participant must clear the child's own conditions and its ancestors' conditions before current completion is granted. The creator can attach parents, while another creator may **encroach** by attaching a freight they own as a parent only if they hold at least **10 times the child's creator's current FBARS** at that moment. The relationship rejects cycles and redundant "absolute" links, and the tree can be inspected from Freight Options. Adding a new head parent re-evaluates completion throughout its descendants. It does **not** reverse CKB rewards that were already paid: past settlement is historical, while current off-chain completion can become pending for future interactions.

**Signable/approval gates** are shown as mounted signals even though they are not chosen from the ordinary app catalogue. Tagged `@approve` wallets approve with signed CKB transactions. Ordinary raffles may require approvals before commencement (all or a threshold, before the start-delay deadline) or unanimous approval before delivery; recurring raffles support the initial commencement gate. Gift freights support a commencement approval gate, including all/threshold quorum, before claims and release. The contract stores approver lock hashes and approval state, and checks the relevant transition instead of trusting only a UI badge. This is useful when funders want an inspector's consent before a funded deliverable proceeds. It is important not to conflate the stages: **on-delivery approval is currently an ordinary-raffle option, while the implemented gift gate is on commencement**.

The code also contains a Google Forms verification path, but **Forms is currently disabled in the mountable chooser**. I do not want reviewers to mistake its presence in the repo for a ready-to-select live integration. Rewardable and signable icons on freight cards are likewise indicators of behavior, not separate third-party apps.

### Social context and transparency

FON includes profiles, a freight feed, comments, likes, reshares, quote/reference actions, photos, wallet-linked activity, and weekly/overall leaderboards. Profiles also calculate an ADSF metric from verified reward payouts, direct tips, and gift claims. Freight cards surface status, type, time remaining, creator identity, and mounted-condition indicators; the detail view exposes participation and financial actions. The separately hosted Checkbox Demo has a visible log of registration, inbound FON webhooks, outbound participant updates, and responses, with secret fields redacted. These interfaces are meant to make a freight's rules and its integration behavior inspectable, not just to hide them behind a final "success" label.

## How to Use (The Flow and How to Test)

### As a FON user

1. Open the testnet FON app and connect a CKB wallet. Obtain testnet CKB before attempting transactions that need capacity, fees, tickets, or funding.
2. Create a freight with a title and body. Choose the freight type with its first hashtag, then set its timing, funding, ticket, or gift parameters. Add `#mounted` to open the mountable chooser. Select built-in conditions and/or the registered Checkbox Demo, configure the desired principles, and review the resulting freight before signing and publishing.
3. Other users can inspect the freight and its mounted conditions. Where allowed, they can tip, deposit, buy tickets, approve, claim, or complete the task. The app evaluates the appropriate conditions for their own wallet before treating them as complete or eligible.
4. For a raffle, let the entry window close and inspect the draw and settlement actions. For a recurring raffle, inspect the sleep/cash-out period and next round. For a connected freight family, use **Freight Options > View tree** to see dependencies.

### Test FON with the live Checkbox Demo

1. In FON, publish a testnet freight with `#mounted` and select **FON Checkbox Demo**. Choose at least one principle, such as a checkbox or **Exact Text Match** with your chosen word. Give the freight enough active time to complete the test.
2. Open the separately hosted Checkbox Demo and connect **the same JoyID wallet address** used in FON. Check the required boxes or enter the exact word. A different address is a different participant.
3. Watch the demo's **Logs** to distinguish FON-to-demo mount/activity requests from demo-to-FON event updates and FON's responses. Return to the freight to inspect whether its selected principles and overall completion changed. Expired mount credentials should no longer authorize new updates.

### As a developer integrating an app

1. Deploy a backend with a public logo and the SDK endpoints for mount verification and activity webhooks. Define a manifest containing a stable `appId`, app metadata, and principle definitions with their parameter schemas.
2. From trusted server-side code, call `registerWithFon(fonUrl, manifest)` **once**. Keep the returned registration credential private; provide it only for later authenticated manifest updates and for verifying FON's calls. The live Checkbox Demo in the repository is a concrete Next.js implementation of this flow.
3. When FON calls your verification endpoint, validate the creator's selected principles and parameters. When FON later calls your activity webhook with `mount.requested`, persist the freight-specific URL, secret, principles, and active window on your backend.
4. Evaluate participant activity against those selected principles and send true/false states to FON during the allowed window. Do not send the app or freight secret to the participant's browser. Consult the repo's `MOUNT_FLOW.md` for payloads and trust boundaries.

First-time third-party registration currently needs stronger ownership verification before it should be opened as unrestricted self-service; that is called out below rather than concealed by the demo.

## Planned Features

- **Secure developer onboarding.** Authenticate who owns an app registration, prove control of its callback origin, prevent first-claim `appId` squatting and duplicate records, add safe credential rotation/recovery, and harden outbound URL fetching. The current registered demo is controlled; the first-registration API is not yet a public developer marketplace.
- **V4 participant cells.** Introduce a dedicated participant type script and stable campaign identity for first-class, queryable on-chain participant records. Today participant cells are recognized largely by lock and data shape, which makes discovery and settlement harder. Multi-ticket purchases and a configured ticket cap already exist; V4 is about clearer participant discovery, refund paths, and lifecycle validation without depending on mutable campaign outpoints.
- **`#Stocks` prediction markets.** Explore fully collateralized binary YES/NO markets, not actual equity stocks or leveraged short selling. A user could buy either outcome, potentially sell a position before resolution, and redeem a winning share against transparent collateral after an agreed oracle/resolution process. Order-book, AMM, and pari-mutuel constructions are still design choices; this is not a live market.
- **NDAO / DAO-yield raffle mountable.** The `NDAO.md` concept combines NervosDAO-generated yield, iCKB's more liquid access to DAO-backed value, and FON's existing round-based raffle UX. Participants would opt to pool **yield**, receive tickets according to a disclosed deposit formula, and choose to exit or stay after a round. Principal treatment, fees, yield accounting, winner tapering, and exit semantics must be explicit before implementation. This is a proposed extension, **not** current DAO integration or a claim that principal is risk-free.
- **CKB names and wallet adoption.** Let users obtain CKB names as human-readable identities for profiles, mentions, and recipients. Wallets that adopt the naming scheme could let someone send CKB to a verified name instead of manually entering an address. I have not settled the right naming or resolution approach, or received a go-ahead from people with deeper Nervos ecosystem context; I am seeking that guidance before committing to a design. Name resolution must still lead to a verified wallet destination before a transaction is signed.
- **Complete currently restricted integrations.** Finish and enable the Google Forms mountable, add clear reference-only freight `refs`, and revisit currently unavailable `@receive` streaming only with enforceable payout semantics. Expand hosted-app examples and test webhook retries, expiry, and recovery end to end.
- **Deeper review and operational hardening.** Audit contract payout and approval invariants, raffle reveal liveness and fairness, participant discovery, the off-chain/on-chain completion boundary, and deployment/monitoring. Keep push webhooks as the default; enable polling only with an appropriate scheduler and cost model.

## Links

- Repository and technical docs: https://github.com/Birdmannn/fon
- FON: https://freight43.vercel.app
- Checkbox Demo: https://checkbox-demo.vercel.app
- Mount protocol: https://github.com/Birdmannn/fon/blob/v3/MOUNT_FLOW.md

## Feedbacks

I have tightened much of the UI and contract behavior over the past months, but I wanted to release a demo now rather than wait for every edge case to be settled. I would especially appreciate feedback on the CKB contract's safety and payout rules, raffle fairness, whether the on-chain/off-chain completion split makes sense, and the security and developer experience of the mountable-app protocol. Specific failure cases, design concerns, and suggestions for what to tighten next would be very helpful.

JoyID has been my preferred wallet for testing and is the wallet used by the Checkbox Demo. I cannot yet vouch for the configuration and full transaction flow of other wallets; that integration work needs further testing and tightening. More test users, particularly for recurring raffles and mixed-wallet participation, would expose issues that my current three-wallet setup cannot reliably uncover.

**FON's interface is optimized for mobile, but I hope you can also explore it on a wider screen, ideally on your first visit. I may have left out details about the leaderboard, its perks, and other features I have forgotten to mention here. Please take some time to explore the app, and thank you for your feedback.**
