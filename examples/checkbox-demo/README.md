# FON Checkbox Demo

This is a tiny hosted-app demo for `@freightonervos/fon-sdk`.

It demonstrates the principle model from `PRINCIPLES.md` with a local login and checkboxes:

- `demo-checkbox-completed`: one configured checkbox must be checked
- `demo-checkbox-count-at-least`: at least `minCompleted` boxes must be checked
- `demo-checkbox-set-completed`: a configured checkbox set must be checked
- `demo-exact-text-match`: the participant must type the exact text configured by the freight creator

The app exposes the hosted-app endpoints FON can call:

- `GET /api/manifest`
- `POST /api/verify-install`
- `POST /api/activity`
- `GET /api/poll`
- `POST /api/evaluate`

## Run

```bash
cd examples/checkbox-demo
npm install
npm run dev -- --port 3001
```

Open `http://localhost:3001`.

## Register With A Local FON Frontend

Run the main frontend on `http://localhost:3000`, then from the demo app:

```bash
curl -X POST http://localhost:3001/api/register
```

The demo registers itself using `FON_BASE_URL` and `NEXT_PUBLIC_APP_BASE_URL`.

Registration is a one-time app-level operation. The demo stores the returned
registration credential in the git-ignored `.fon/registration.json` file and
loads it after restarts. Set `FON_REGISTRATION_SECRET` instead when deploying to
an environment with an ephemeral or read-only filesystem. Calling
`POST /api/register` again is only needed to publish manifest changes; the demo
authenticates that update with its existing credential. Once an app is mounted
on a freight, checkbox changes are pushed back to FON automatically. FON can
also poll the demo with authenticated `POST /api/poll` requests.

Mount setup validates the selected principles and configuration; it does not
deliver event credentials. When the freight is published, FON sends
an authenticated `mount.requested` event to `/api/activity`. That event contains
the final freight id, selected principles, mounted instance id, exact FON event
URL, mount-scoped secret, start/end timestamps, and duration in seconds. The demo
only pushes checkbox events while that window is active; FON independently
rejects early or expired events.

After pulling the exact-text demo principle for the first time, call
`POST /api/register` once so the existing FON app record receives the updated
four-principle manifest. This updates the existing app registration; it does not
create a duplicate or rotate its credential.

## Run The Poll Worker Locally

In development the worker endpoint is available without a cron secret:

```bash
curl http://localhost:3000/api/mountables/apps/poll
```

Production deployments must set `FON_POLL_CRON_SECRET` or `CRON_SECRET` and send
it as a bearer token. `frontend/vercel.json` schedules this endpoint once per
minute; each installation's `pollIntervalSeconds` still controls whether it is
due.
