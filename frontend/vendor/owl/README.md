# Owl Pilot dependency snapshots

## Current revision: 1e16e9c (1 November 2026)

`owl-pilot-1e16e9c.tgz` and `owl-pilot-react-1e16e9c.tgz` are built from a clean
checkout of upstream commit `1e16e9ccf689cdcdd0bc2347c9825f16d6408a60` at
https://github.com/Birdmannn/owl. The lockfile pins both archive integrity hashes.
The SDK's compiled files exactly match the earlier local
`owl-pilot-mixed-payouts-20261101.tgz` snapshot; the React compiled files also match
the previous `2886284` snapshot. The other session's FON integration therefore
uses the committed API without local SDK patches. Older archives remain for
provenance.

FON offers one Tip a creator permission across supported recipient wallet
programs and one Distribute rewards permission for 1–64 mixed-wallet payouts.
The catalog contains 30 choices (15 message and 15 transaction policies), with
at most 16 selected per session.
Script `anyOf` choices and guarded `forEach.anyOf` identity branches bind each
recipient wallet program to its ticket identity. Common campaign checks, equal
counts, empty payout data and no type remain mandatory. `includeAccountOutputs`
keeps ordinary payouts to the signing account in those same checks.

The updated SDK is installed in both FON's client and message verifiers. The
hosted wallet asset `wallet-Cv5U1yon.js`, checked on 1 November 2026, contains
`anyOf`, `outputLock` and `includeAccountOutputs`. This confirms the matcher
fields are present; it does not establish a funded end-to-end distribution.
Changed grants require explicit replacement approval and never silently broaden.
No Pilot contract deployment is required. FON's direct wallet-payout contract
was freshly deployed and verified on testnet on 1 November 2026; see
`contracts/freight/README.md` for its new identity. Live funded mixed-wallet
distribution remains unverified.

## Earlier SDK status (superseded by the mixed-wallet snapshot)

## Previous revision: 2886284 (30 October 2026)

`owl-pilot-2886284.tgz` and `owl-pilot-react-2886284.tgz` are built from the clean
upstream commit `288628434e10a24b740bceb97de5fe5362c06d33` at
https://github.com/Birdmannn/owl, without source changes. Both dependencies and
lockfile integrity hashes pin these archives. The SDK's compiled files match the
previous local `owl-pilot-batch-20261030.tgz` snapshot byte for byte; its README
now comes from the committed upstream revision.

This revision adds bounded `forEach` template comparisons. The current FON
catalog contains 33 choices, of which at most 16 may be selected.

The old Distribute rewards template preserved each ticket's FON lock and data.
That authorized an escrow update, not a spendable wallet payout. It has been
removed as part of the regular raffle payout correction. Regular distribution
now creates empty-data, untyped participant wallet outputs and requires an
updated FON contract deployment. The pinned Pilot SDK cannot express different
wallet script programs as alternatives in one repeated output role. Distribution
therefore uses Pilot's existing one-time transaction review; its automatic
policies for other actions remain available.

Pilot needs script-pattern alternatives for a repeated payout role (including
mixed JoyID, secp256k1, OmniLock and Pilot recipients), with per-entry identity and
amount comparisons, before FON can offer one automatic Distribute rewards
permission for these wallet payouts. Updating only the SDK label or keeping the
old escrow-preserving matcher would not authorize the actual payment. FON has
not patched the vendored SDK or broadened previously approved grants.

The hosted wallet's public asset `wallet-DVQ_SwT2.js` was checked on
30 October 2026 and contains the `forEach` schema and `each` index resolution.
Live funded distribution with the corrected payout contract has not been
performed. Message verifiers must also install this SDK to validate proofs
containing the new template schema.

To reproduce the archives from a clean checkout of this commit:

```sh
npm ci --ignore-scripts
npm run build
npm ci --ignore-scripts --prefix packages/react
npm run build --prefix packages/react
npm pack --pack-destination /absolute/path/to/output
cd packages/react
npm pack --pack-destination /absolute/path/to/output
```

Rename the generated archives with the commit suffix, update both `file:`
dependencies, and run `npm install` in `frontend`. Commit the dependency manifest,
lockfile and archives together. CCC core remains pinned to `1.23.0`.

## Historical revision: 9e52649

These npm package archives were built from https://github.com/Birdmannn/owl at
commit `9e52649a5df8b1df9be1d73610e9e4028051b7b8` (28 October 2026).
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


General signing mode is enabled in FON through `accountMode: "general"` and
`pilotTemplatePolicy`. The snapshot includes the general-account testnet deployment
pin and wallet-enforced whole-transaction templates, with script/data fields,
relations and witness rules. FON supplies its own publish, status and ticket
patterns. Template semantics are not enforced by the general account contract;
the cumulative CKB allowance, signature and authority continuity are. The hosted
wallet/paymaster must run the matching deployment. General mode creates a new
spending address; old test sessions are not migrated.
