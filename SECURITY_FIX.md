# Security Fix: Hosted App Registration

Status: **Not implemented.** Do not treat the current registration endpoint as an
open, self-service developer registry.

## Current behavior and risk

`POST /api/mountables/apps/register` accepts the first valid manifest for any
unused `appId` without authenticating the developer or proving control of the
app's URLs. FON generates a `registrationSecret`, stores the manifest in MongoDB,
and returns the secret to the caller. Subsequent updates to that `appId` require
the secret. The SDK's `registerWithFon()` is a server-side wrapper around this
endpoint; it does not add initial-registration authorization.

This allows the first caller to claim another developer's intended `appId`, put
their own logo and endpoints in FON's mountables catalogue, and retain control
of that listing. The current read-then-upsert also needs a unique `appId` index
and an atomic claim path so simultaneous first registrations cannot create
duplicate records. FON currently stores the raw registration secret as well as
its hash because it sends the secret when authenticating outbound app calls;
hashing the stored value alone would break those calls.

## Required registration flow

1. The developer signs in to FON with a verified account or wallet challenge.
   FON derives the owner identity from that session or signature, never from a
   client-supplied `ownerId` field.
2. The developer submits a manifest. FON validates its logo, principle list,
   HTTPS callback URLs, and sync mode, then creates a short-lived, single-use
   challenge for the claimed app origin. Reserve FON-owned names and define a
   dispute/recovery policy for names that resemble third-party brands.
3. The hosted app proves control by serving that challenge from the claimed
   origin, or by another verifiable domain-control mechanism. FON fetches and
   validates it server-side. Do not send registration credentials or mount
   requests until this check passes.
4. FON atomically claims the `appId` for the authenticated owner, with a unique
   database index on normalized `appId`. A conflicting claim fails without
   changing the existing record. Pending registrations expire.
5. FON issues an app-level `registrationSecret` to the developer's trusted
   backend or shows it once in an authenticated management flow. The developer
   saves it in a secret manager, not in frontend code or `NEXT_PUBLIC_*` env.
   Only verified registrations appear in the public mountables catalogue.
6. SDK manifest updates may continue to use the existing app secret, but that
   credential cannot change the recorded owner. URL changes, ownership
   transfer, credential recovery, and revocation require owner authentication;
   a new app origin also requires fresh proof of control. Secret loss needs an
   owner-authenticated recovery path; possession of an `appId` alone is
   insufficient.

The app-level registration secret authenticates later FON-to-app callbacks and
automated registration updates. It is **not** the freight-specific
`eventWebhook.secret` issued when an app is mounted. Mount secrets remain scoped
to one freight and its active timeframe; see [MOUNT_FLOW.md](MOUNT_FLOW.md).

## Implementation checklist

- Add authenticated developer ownership to app records and an owner-only
  registration/manage API. Bind wallet challenges to a nonce, domain, expiry,
  and intended action; reject replayed signatures.
- Add an expiring, one-time app-origin challenge. Restrict server-side URL fetches
  to public HTTPS destinations and block redirects to private or loopback
  addresses to avoid SSRF. Allow explicit local development exceptions only in
  non-production environments.
- Add a unique index on normalized `appId`. Audit and resolve any existing
  duplicate records before creating the index. Make first claim atomic and
  handle duplicate-key errors as conflicts.
- Migrate existing registrations to an owner through an explicit, verified
  claim process. Do not silently assign ownership to whoever next presents an
  `appId`; keep existing mounts working during migration.
- Stop returning the raw registration secret on ordinary manifest updates.
  Return it only on initial issuance or explicit rotation. Store its verifier
  as a hash; protect any reversible copy needed for outbound authentication
  with encryption and restricted access, or replace that outbound scheme with
  signed requests. Design rotation so the hosted app can accept the new secret
  before FON switches outbound callbacks to it, then retire the old one.
- Protect the developer management UI and API against CSRF, brute-force
  attempts, and excessive registration requests. Audit registrations, URL
  changes, rotations, revocations, and failed ownership checks without logging
  secrets.

## Acceptance tests

- An unauthenticated caller cannot claim an unused `appId`, even with a valid
  manifest. An authenticated developer cannot claim another owner's `appId`.
- A claimed origin must answer the one-time challenge; replay, expired proof,
  private-network URLs, and a later URL swap without new proof are rejected.
- Concurrent claims produce exactly one registered record and one owner.
- The owner can update, rotate, recover, and revoke the app; another account
  cannot. Rotation retires the old secret after a bounded handover, without
  losing FON-to-app callbacks.
- Secrets never appear in catalogue responses, browser bundles, routine update
  responses, or logs. Existing registered apps and active mounts survive the
  ownership migration without being silently taken over.

Until this is implemented, restrict first-time registrations operationally to
trusted developers and review new records before exposing them in the
mountables catalogue. An app developer can currently call the SDK or endpoint
from a trusted backend, but that is not a secure public onboarding process.
