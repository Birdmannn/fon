# Freight on Nervos

Freight on Nervos (FON) is a CKB application for creating and participating in
freights: tasks, gifts, and raffles with configurable participation criteria.
Creators can attach built-in criteria or mount hosted apps that evaluate their
own principles. The CKB contract handles on-chain freight actions; the Next.js
application uses MongoDB for profiles, freight metadata, app registrations, and
off-chain participation state.

## Repository layout

| Path | Purpose |
| --- | --- |
| [`frontend/`](frontend/) | Next.js app, API routes, wallet flows, and MongoDB integration |
| [`contracts/freight/`](contracts/freight/) | CKB freight contract |
| [`packages/fon-sdk/`](packages/fon-sdk/) | SDK for hosted mountable apps |
| [`examples/checkbox-demo/`](examples/checkbox-demo/) | Hosted app example using the SDK and JoyID |
| [`checkbox-demo/`](checkbox-demo/) | Separately deployable checkbox demo with a GitHub SDK dependency |
| [`tests/`](tests/) | Contract tests |

## Run the app locally

1. Install the dependencies in `frontend/` with `npm install`.
2. If you do not already have `frontend/.env.local`, create it from
   [`frontend/.env.example`](frontend/.env.example). Set `MONGODB_URI` to a
   reachable MongoDB instance and review the CKB network and freight contract
   settings. Do not commit real credentials.
3. Start the app:

   ```bash
   cd frontend
   npm run dev
   ```

Open <http://localhost:3000>. The sample environment targets CKB testnet;
wallet and contract settings must refer to the same network. Google account
linking requires its own Google OAuth credentials.

The hosted checkbox example runs separately on port 3001. Follow its
[setup and one-time registration instructions](examples/checkbox-demo/README.md)
to connect it to a local FON app. Pull polling is disabled by default; the
[frontend guide](frontend/README.md) explains its opt-in environment flag and
optional scheduler.

To deploy the demo as its own application, use the [standalone demo guide](checkbox-demo/README.md).

## Build and test

```bash
cd frontend
npm test
npm run lint
npm run build
```

For the Rust contract, see its [build and deployment notes](contracts/freight/README.md).
Contract tests can be run from the repository root with
`cargo test -p tests -- --test-threads=1`. The [testing notes](TESTING.md) cover
CKB cell inspection and deployment checks. Building or testing does not deploy
the contract.

## Documentation

Start with these guides for the current project structure and integration flow:

- [Mount flow](MOUNT_FLOW.md): app registration, mount setup, webhook credentials,
  event delivery, polling, and the active freight window.
- [Registration security fix](SECURITY_FIX.md): required ownership and endpoint
  verification before opening app registration to third parties.
- [Checkbox demo](examples/checkbox-demo/README.md): run and register a hosted
  mountable app locally.
- [Standalone checkbox demo](checkbox-demo/README.md): deploy the demo separately with the SDK installed from GitHub.
- [Frontend guide](frontend/README.md): app setup, environment variables, and
  mounted-app polling.
- [Freight contract](contracts/freight/README.md): approval and gift-claim rules,
  contract build, and deployment reference.
- [Principles](PRINCIPLES.md): the model used by hosted apps to define and
  evaluate participant criteria.

The following documents provide deeper design and operational background.
Some describe earlier iterations, so check the current code and contract notes
before treating them as implementation or deployment instructions:

- [Principles implementation notes](PRINCIPLES2.md)
- [Freight trees and links](docs/FREIGHT_TREE.md)
- [FBARS and gift deliverables](docs/FBARS_AND_GIFT_DELIVERABLES.md)
- [Raffle randomness and winner selection](docs/RAFFLE_WINNER_SELECTION.md)
- [Contract capacity and local testing](docs/CONTRACT_CELL_CAPACITY_AND_LOCAL_FRONTEND_TESTING.md)
- [Devnet frontend signer workflow](docs/DEVNET_FRONTEND_SIGNER_WORKFLOW.md)
- [Changelog](CHANGELOG.md)

### Pilot passkey wallet and signing permissions

The frontend integrates Pilot's separate passkey wallet using `PilotWalletProvider`
and `PilotHostedSigner`. It defaults to `https://owl-pilot.vercel.app`, the hosted
wallet used by the official Pilot demo. Override `NEXT_PUBLIC_PILOT_WALLET_URL` in
`frontend/.env.local` for another deployment or `http://localhost:5176` when
running the upstream wallet locally. The wallet must run on a different origin from Freight,
with its own deployed contracts and configured paymaster. The wallet's setup and
funding UI is provided upstream: https://github.com/Birdmannn/owl/blob/main/PILOT_WALLET.md.
No wallet private keys or paymaster secrets are added to Freight.

Connect Wallet opens the animated info modal with **Pilot**, **JoyID**, and
**Connector** stacked under “Connect Wallet:”. JoyID opens authentication directly;
Connector opens CCC’s wallet chooser with JoyID excluded. Selecting Pilot opens
its embedded modal. Pilot owns account setup,
permission checkboxes, spending-budget selection, balances, logs and recovery.
FON requests a maximum session budget of 1,000,000 CKB; users can choose a lower limit
in Pilot before approving it.
No Freight permission picker precedes it. Closing the modal keeps its isolated
iframe alive for approved automatic signing. The header Disconnect action reopens
the account modal.

FON separates 28 app actions into transaction and message capabilities. The SDK
snapshot is pinned to Owl commit `9e52649a5df8b1df9be1d73610e9e4028051b7b8`.
Connection requests `accountMode: "general"` and uses `buildPolicies` to validate
the selected owner/account pair before offering 15 real message scopes and
26 whole-transaction templates covering all 15 FON transaction action IDs:

- **Publish freight**, **Update freight status (includes raffle activation)** and
  **Buy raffle tickets** cover future campaign configurations and regular/recurring
  raffles. Publishing binds creator fields to the selected account's first 20
  lock-argument bytes (FON's on-chain identity format); ticket purchases bind the
  beneficiary to that account.
- **Approve freight**, **Confirm raffle approval**, **Cancel freight**, **Claim a
  gift**, **Deposit support** and **Withdraw support** each require their own
  operation selector. Cancellation and withdrawal bind the creator to the account;
  gift and withdrawal payouts must return to that account. Their occupied-capacity
  top-ups are bounded to 1,000 CKB, also subject to the selected session budget.
- **Tip a creator** has separate recipient-script policies for JoyID, secp256k1,
  OmniLock, Pilot general accounts and Pilot passkeys. Each binds the recipient's
  first 20 lock-argument bytes to the campaign creator, as required by the deployed
  FON contract. Unsupported recipient scripts require owner review. A Pilot owner
  address whose lock-argument prefix differs from the on-chain creator cannot
  receive a direct tip under the current contract; this integration does not
  change that contract rule.
- **Deliver rewards** has eight batch-size policies for 1–8 raffle winners. Every
  winner's lock and identity is preserved, and all entries must belong to the
  campaign. The SDK has no `foreach` relation, so the rules explicitly compare
  every input/output pair. Select the batch sizes you intend to use. Larger batches
  and other participant lock/type layouts require owner review.
- **Draw recurring raffle**, **Claim raffle reward**, **Roll over raffle** and
  **Reclaim raffle entry** use separate selectors and pin recurring campaign
  layouts. Claims/reclaims bind the entry beneficiary to the selected account.
  Draws support up to 64 entries; the FON contract additionally verifies each
  output lock, capacity, participant identity, winner order and claimable amount.

Select both status and ticket permissions to purchase from a raffle that first needs
activation. No chain scan or open composer draft is needed to build the catalog.
Templates pin the deployed FON script identity while allowing configuration and
instance fields to vary. The FON contract validates campaign layouts, ticket price
accounting, raffle identity and recurring-round rules. Unexpected application
inputs/outputs fail matching; ordinary account funding/change and authority cells
remain wallet-managed.

The catalog has 41 policies; Pilot offers at most 50 and users may select 16.
Nothing is selected by default. Selected message scopes and matching templates sign
automatically. Unselected actions and transactions outside these templates require
one-time owner passkey review in the same modal without replacing the grant.
Pilot's template schema permits at most 64 occurrences per role: ticket batches
of 1–64 can match automatically; 65–100 still require owner review. JoyID retains its existing
1–100 ticket path and direct wallet signing.

General-mode action templates are enforced in Pilot wallet software, **not by the
on-chain account lock**. The lock enforces the session key, authority continuity,
cumulative net CKB allowance and sponsored fee rules. A stolen session key can
bypass action-template restrictions, and the CKB allowance does not value tokens
or NFTs. Pilot displays this distinction during approval. The same owner address
continues to identify profiles and FBARS; general mode uses a fresh spending
address and fresh owner-approved funding. Existing test sessions are not migrated.
The hosted wallet and paymaster must use this revision's general deployment.

`freightTransactionPolicies` remains an exact-cell effect utility;
`freightTransactionTemplates` supplies the connection templates. Tests use
real FON builders with the SDK's automatic validator, including different future
instances, all transaction builders, every supported reward batch size, malformed
beneficiaries, operation selectors and unexpected payments. Scoped proofs include
the selected templates; the server accepts at most 128 KiB so a valid selection of
16 large FON policies fits without bypassing signature or live-authority checks.

Ticket purchases refresh the raffle's live cell before preparing a transaction.
Activation is decided from current chain state, not the record's activation hash;
stage two waits for a committed activation and resolves its live successor.

Pilot can continue a retained, compatible session after passkey sign-in on the
same wallet storage partition, preserving its original expiry. Request timeouts
pause while the wallet waits for account selection, policy review or passkey input.
These flows require the hosted wallet to be updated alongside FON's SDK.

Pilot profiles use the passkey owner address, so multiple session accounts for
one owner load the same profile. Shared wallet displays on the feed, freight
detail and profile pages show and copy that owner address and query its total CKB
capacity (including typed cells); transaction ownership checks use the session
spending address. External-wallet balance queries retain their existing behavior.
The initial FBARS award queries that owner
address's on-chain balance once (1 FBAR per 1,000 CKB, rounded down); session funds
and spending allowances are not included. Profile photos, marquee edits and Google
links use owner-address challenges. APIs verify that a valid live session proof's
descriptor commits to that owner before authorizing profile actions, and reject
session-address profile/seed proofs. Session addresses remain the spending identity
for transactions and receipts. Previously stored session-address profiles are not
automatically merged or credited again into the owner profile; existing on-chain
freight ownership is unchanged. External wallets other than JoyID retain
Freight's selectable permission list and per-signature wallet approval. JoyID uses
its own signing prompts without the extra FON permission selection. Disconnect
settles receipts before removing the embedded signer; failed settlement keeps the
connection available. Use Pilot's wallet controls to revoke the on-chain session.
The header Disconnect action opens Pilot’s account/session modal first; it does
not immediately settle, revoke or remove the connected signer.

The wallet deployment must allow embedding and delegated WebAuthn. Any app CSP
must allow its origin in `frame-src`. The updated SDK also pins the current
embedded-passkey owner deployment; old accounts referencing reclaimed legacy code
require the upstream recovery/deployment procedure.

Freight builders skip generic fee/input completion for Pilot. The wallet adds its
authority, change and sponsored fee input. Prepared transaction bytes and stable
request IDs are persisted on Freight's origin before submission. An uncertain
response blocks new spending until the original request is retried; retries reuse
the saved bytes and ID. Keep browser storage and wallet receipts until resolved.

API message signatures carry the public account descriptor, current authority state
and scoped proof. Each receiving endpoint supplies its own expected action. The
server verifies the exact address, scope, message, issuing origin, live on-chain
authority, session signature or one-time owner passkey assertion, and expiry through
Pilot's updated verifier (scoped proof versions 1 and 2). MongoDB stores
10-minute signing challenges and atomically consumes them once; an expired/used
challenge requires a fresh request. A TTL index removes old records. A failed
business-rule check after consumption also requires a fresh challenge.

The upstream SDK/UI snapshots and pinned revision are documented in
`frontend/vendor/owl/README.md`. `npm ci` installs the committed archives without a
separate checkout. The action registry is `frontend/lib/owlPermissions.ts`, hosted
signing/transaction retry logic is `frontend/lib/pilotWallet.ts`, and the server
verifier is `frontend/lib/pilotAuth.ts`. Live hardware-passkey, funding and paymaster
validation requires a configured wallet deployment; local checks use simulated
wallet transport and transactions and do not claim public-testnet end-to-end success.

JoyID connects directly from FON's wallet chooser, using CCC's CKB signer without
opening CCC's wallet-selection modal. JoyID actions go straight to its normal
signing prompt without FON's external-wallet permission selection step.
Authentication starts from the button click
so browsers can open JoyID's popup. CCC retains the connected signer and saved
wallet selection. The Connector button opens CCC’s other wallet options, excluding
JoyID, after FON’s info-modal closing transition. Connection and signing errors use FON's animated info modal
with the “Errors:” section.
