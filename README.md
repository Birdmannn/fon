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

All 28 signed actions have individual scoped permissions and are offered together
in Pilot's permission catalog. The SDK permits up to 50 offered policies; the user
may select at most 16 for each grant, including transaction cell/recipient rules.
Nothing is checked by default. Selected message scopes sign automatically;
unselected scopes or transaction effects reopen the same Pilot modal for one-time
owner passkey approval. FON keeps the existing provider, address and session;
it does not reconnect or replace a grant to request a signature. One-time approval
leaves selected policies unchanged and transactions remain bound by the existing
budget, live authority and sponsored fee checks. Cancelled reviews reject the
action without disconnecting. Approved session state is still validated against
the 16-policy limit. Transaction effect policies constrain actual cells and
recipients; message scope names do not interpret Freight methods on-chain.

Pilot can continue a retained, compatible session after passkey sign-in on the
same wallet storage partition, preserving its original expiry. Request timeouts
pause while the wallet waits for account selection, policy review or passkey input.
These flows require the hosted wallet to be updated alongside FON's SDK.

A Pilot account has its own address. Existing profiles, creator permissions and
freight owned by an external wallet do not move to it. External wallets retain
Freight's selectable permission list and per-signature wallet approval. Disconnect
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
opening CCC's wallet-selection modal. Authentication starts from the button click
so browsers can open JoyID's popup. CCC retains the connected signer and saved
wallet selection. The Connector button opens CCC’s other wallet options, excluding
JoyID, after FON’s info-modal closing transition. Connection and signing errors use FON's animated info modal
with the “Errors:” section.
