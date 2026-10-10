# Standalone FON Checkbox Demo

This is a separately deployable copy of [`examples/checkbox-demo`](../examples/checkbox-demo/).
It installs `@freightonervos/fon-sdk` from the [FON GitHub repository](https://github.com/Birdmannn/fon) rather than importing a sibling directory. Push these repository changes before building a remote deployment: the GitHub package entry point is at the repository root.

## Deploy

Create a **separate Next.js project** from this repository and set its root directory to `checkbox-demo`. Do not deploy it as a static export: its API routes receive FON callbacks and participant events. Set these environment variables in the demo project:

| Variable | Value |
| --- | --- |
| `FON_BASE_URL` | Public base URL of the FON frontend, such as `https://fon.example.com` |
| `NEXT_PUBLIC_APP_BASE_URL` | Public base URL of this demo, such as `https://checkbox-demo.example.com` |
| `NEXT_PUBLIC_CKB_NETWORK` | `testnet` or `mainnet`, matching FON |
| `MONGODB_URI` | MongoDB connection string for durable app state; a separate database is recommended |
| `MONGODB_DB_NAME` | Database name, default `fon-checkbox-demo` |
| `FON_REGISTRATION_SECRET` | Existing FON app registration secret; set after first registration if this is a new app |

Put real values in this project's `.env.local` for local development and in your hosting provider's environment settings for deployment. Never put the registration secret in a `NEXT_PUBLIC_` variable. The database stores installation webhook secrets and participant state, so restrict database access accordingly.

## Register or update the app

FON stores this app by `appId` (`fon-checkbox-demo`), so **do not register a second app** when moving the existing demo to a public URL. Take the current secret from `examples/checkbox-demo/.fon/registration.json` (or its `FON_REGISTRATION_SECRET` environment variable), set it in the standalone demo, and update the registration once with the public `NEXT_PUBLIC_APP_BASE_URL`:

```bash
cd checkbox-demo
npm install
npm run dev -- --port 3001
curl -X POST http://localhost:3001/api/register
```

The registration request goes from this demo's backend to `FON_BASE_URL`; its manifest points FON to the public demo URL. The locally running demo saves the registration secret in its git-ignored `.fon/registration.json`. For a brand-new registration, read that file and set the returned secret as `FON_REGISTRATION_SECRET` in the deployed demo, then redeploy. If the app is already registered, provide its existing secret **before** calling `/api/register`, so FON updates the existing record. Production requests to `/api/register` are rejected until `FON_REGISTRATION_SECRET` is configured.

`GET /api/manifest`, `POST /api/verify-install`, `POST /api/activity`, `POST /api/poll`, and `POST /api/evaluate` are the endpoints used by FON. On freight publication FON sends the mount-scoped event grant to `/api/activity`. The demo stores that grant in MongoDB and pushes participant updates only during the grant's active timeframe. FON independently rejects updates after expiry. Polling is optional and controlled on FON, not by this deployment.

For local-only development without MongoDB, the demo falls back to process memory and a git-ignored `.fon/` file. A deployed serverless app needs `MONGODB_URI`; local memory/files will not survive across instances.
