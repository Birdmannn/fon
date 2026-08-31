# FON Checkbox Demo

This is a tiny hosted-app demo for `@freightonervos/fon-sdk`.

It demonstrates the principle model from `PRINCIPLES.md` with a local login and checkboxes:

- `demo-checkbox-completed`: one configured checkbox must be checked
- `demo-checkbox-count-at-least`: at least `minCompleted` boxes must be checked
- `demo-checkbox-set-completed`: a configured checkbox set must be checked

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
