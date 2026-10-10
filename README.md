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
