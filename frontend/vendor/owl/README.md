# Owl Pilot dependency snapshots

These npm package archives were built from https://github.com/Birdmannn/owl at
commit `8939062faaf4e4485b228188c47b785bfab35200` (24 October 2026).
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

This revision adds one-time owner passkey approvals for unselected message scopes
and transaction effects, retained-session reconnection, and progress-aware request
timeouts. FON keeps the same provider during action review; its server verifier
accepts both selected-scope (v1) and owner-passkey (v2) scoped proofs. The hosted
wallet must run this revision too to support these flows.
