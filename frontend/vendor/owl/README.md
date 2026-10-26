# Owl Pilot dependency snapshots

These npm package archives were built from https://github.com/Birdmannn/owl at
commit `e5a5e812d86181c613465dd089e405b2aca0859d` (25 October 2026).
They contain the upstream SDK and React UI without source modifications.
Keeping the archives in this repository makes `npm ci` independent of a sibling
checkout or a private package registry. CCC core is pinned to `1.23.0`, as required
by Owl's installer.

To refresh, check out the chosen Owl revision, then run:

```sh
npm ci
npm run build
npm ci --prefix packages/react
npm run build --prefix packages/react
npm pack --pack-destination /absolute/path/to/frontend/vendor/owl
cd packages/react
npm pack --pack-destination /absolute/path/to/frontend/vendor/owl
```

Name the new archives with the chosen commit suffix, update both `file:` dependencies
in `frontend/package.json`, and run `npm install` in `frontend` after replacing
the archives. Commit the updated lockfile and both archives together.

The `/public/owl.png` asset is copied from the same revision's demo.

Includes one-time owner passkey approvals for unselected message scopes
and transaction effects, retained-session reconnection, and progress-aware request
timeouts. FON keeps the same provider during action review; its server verifier
accepts both selected-scope (v1) and owner-passkey (v2) scoped proofs. The hosted
wallet must run this revision too to support these flows.

The passkey compatibility fix explicitly negotiates wallet progress events with
`progress=1`, requires response methods to match their pending requests, and
validates missing connection results. It fixes progress events being mistaken for
connection responses during saved-passkey sign-in. The corresponding hosted-wallet
fix also protects older SDK clients; users do not need to clear wallet storage.

Replacement-grant counters are derived from the live authority
under the wallet operation lock after pending receipts settle, preserving the
reviewed budget and policies. SDK, hosted-wallet and React errors now use the
idempotent `Pilot says: ` prefix; FON forwards SDK errors to its existing Errors
info modal. No contract deployment or FON signing API change is required.

The SDK delegates clipboard writing to the wallet frame, adds manual
address selection when copying is blocked, and uses an accessible borderless
close icon. The matching hosted-wallet balance UI counts total capacity including
typed cells and distinguishes the spending allowance from available funds.

This snapshot matches the hosted-wallet request-ordering fix: connection replies
are sent after grant/resume UI work finishes, allowing FON's immediate logs request
to proceed without a spurious busy error. The fix lives in the hosted wallet and
requires its redeployment; the SDK and React source APIs are unchanged in this
revision. Shorter Pilot payment addresses remain an upstream V2 proposal.

The latest UI revision gives the embedded close icon a light-green (#c7f881)
stroke and the hosted-wallet content equal padding on all sides (28px, or 20px
on narrow viewports). The padding requires the matching hosted-wallet deployment.


This revision adds the pre-approval public-account handoff through
`connect({ buildPolicies })`. The wallet emits `accountSelected`; the SDK builds
and validates the account-dependent catalog and returns `policiesReady`, bound to
the current account selection. FON now supplies real publication and raffle-ticket
output policies before the user approves a grant. The matching hosted wallet must
support `accountPolicies=1`; account switching rebuilds the offered catalog.
