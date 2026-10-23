# Owl Pilot dependency snapshots

These npm package archives were built from https://github.com/Birdmannn/owl at
commit `c67259d91dd797e0689a20caf6b921f0767fd1af` (23 October 2026).
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
