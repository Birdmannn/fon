This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Mounted-app pull polling is opt-in. Set `FON_POLLING_ENABLED=false` (the
default) to use push webhooks without polling. The authenticated `GET`/`POST
/api/mountables/apps/poll` endpoint reports `enabled: false` and performs no
polling in that mode. Webhook event windows are enforced independently, even
without a poll worker clearing expired secret hashes.

To enable pull polling later, set `FON_POLLING_ENABLED=true` and configure a
scheduler to call `/api/mountables/apps/poll`. The environment variable alone
does not schedule requests. Vercel's former one-minute cron entry was removed
to allow Hobby deployments; add a suitable schedule back when your plan allows
it, or use an external scheduler. Production requests require a bearer token
matching `FON_POLL_CRON_SECRET` (or `CRON_SECRET`). Each mount is polled only
when its `pollIntervalSeconds` has elapsed.

App registration requires a public `logoUrl`, an `activityWebhookUrl`, and at
least one principle. FON persists the manifest and shows the app logo in the
`#mounted` chooser.

Registration is performed once per `appId`. FON stores the app manifest and
credential in MongoDB. The hosted app must retain the returned registration
secret; later manifest updates and secret rotations are authenticated with that
secret, while ordinary app restarts require no FON registration call.

Mount setup validates the selected principles and configuration. After the
freight receives its canonical ID, FON sends an
authenticated `mount.requested` event to the registered `activityWebhookUrl`.
That event contains the selected principles, freight window, duration in
seconds, and a distinct per-freight event webhook grant. The grant secret
authenticates app-to-FON updates and works only from task start until task end.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
