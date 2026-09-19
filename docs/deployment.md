# Deploying Lumenade Pay

## What has to run

Lumenade Pay is two Node processes and a database, not one deployable unit.

| Process | Shape | Why |
| --- | --- | --- |
| `@rosapay/api` | Long-lived HTTP server | Holds the relayer and admin Stellar keys, keeps a PostgreSQL pool, and waits on the ledger while a settlement confirms |
| `@rosapay/worker` | Long-lived loop | Reconciles submitted settlements against RPC receipts and expires abandoned requests on an interval, with graceful shutdown |
| PostgreSQL | Managed instance | Intents, settlements, authorizations, merchant profiles, device wallets and the audit trail |

The mobile app talks only to the API. Nothing in the app reaches the database
directly, which is why the database needs no row-level policies for the app's
sake: the API is the only writer, and it is the only holder of the keys that can
pay a fee or register a merchant.

## Choosing a database

Any PostgreSQL 16 works. The code speaks plain `pg` through a driver-neutral
port, and `npm run db:migrate` applies checksum-guarded SQL that is not tied to
any provider's tooling. Supabase, Neon, RDS and a container all behave the same
here; pick on operations, not architecture.

If you use Supabase, three details matter:

- **Which connection string.** The pooled connection (pgBouncer, transaction
  mode) suits the API. The worker holds a connection across its cycle, so give it
  the session pooler or the direct connection. Set `DATABASE_MAX_CONNECTIONS` low
  per instance — the pool multiplies by instance count, and a pooler has a hard
  ceiling.
- **TLS.** Set `DATABASE_SSL=true`; the client then verifies the certificate
  rather than trusting anything that answers.
- **Keep the migrations.** The repository's runner records a checksum per file
  and refuses a migration that changed after it was applied. Running Supabase's
  own migration tooling alongside it would leave two sources of truth for the
  same schema.

Supabase Auth, PostgREST and row-level security solve a problem this design does
not have: they matter when a client talks to the database directly. Adopting them
here would add a second authorization model next to the passkey sessions the API
already owns.

## Why the backend is not a serverless deployment

Vercel and equivalent platforms fit the merchant web dashboard, which is a
frontend. They do not fit this API, for reasons that are specific rather than
stylistic:

- **The worker has no serverless shape.** It is an interval loop with
  non-overlapping cycles and graceful shutdown. Recreating it as a scheduled
  function means a cold start per tick, a new database connection per tick, and
  losing the guarantee that two cycles never overlap.
- **Settlement waits on the ledger.** Provisioning a wallet is two Testnet
  transactions and takes around thirty seconds; confirming a payment polls until
  the receipt lands. That exceeds a 10-second function limit outright and leaves
  no headroom under a 60-second one.
- **The rate limiter is per process.** It bounds what one instance can be driven
  to do. Spread across many short-lived instances it bounds nothing, so a
  serverless deployment would need a shared store before the funding endpoints
  are safe to expose.
- **Connections multiply.** Each instance opens a pool; a platform that scales
  instances per request needs a pooler in front of PostgreSQL and a much smaller
  `DATABASE_MAX_CONNECTIONS`.

A small always-on host — Fly.io, Railway, Render, or a VM — runs both processes
as they are written. Deploy the API and the worker separately so the worker can
restart without interrupting payments.

The repository includes a Docker image and a Render blueprint. The blueprint
uses Render's free web service for the API and a separately billed worker
service, because Render does not provide a free always-on background worker.
For a small TestFlight group this is still the smallest production-shaped
deployment: use a free Supabase or Neon PostgreSQL database, keep the worker on
the provider's smallest plan, and move it to another host later without code
changes. The worker must not be replaced with a sleeping cron job: payment
confirmation and expiry need a continuous loop.

### Render + Supabase/Neon

1. Create a PostgreSQL project and copy its TLS connection string. Use the
   provider's pooled connection for the API and a session/direct connection for
   the worker when both are available.
2. Create a Render Blueprint from this repository. `render.yaml` creates
   `rosapay-api` and `rosapay-worker`; enter the same database URL and the
   Testnet secrets in both services where requested.
3. Before deploying, validate the environment without printing any secret:

   ```sh
   npm run deploy:check
   ```

   Every check must be `true`. The command intentionally rejects a missing
   session secret, in-memory storage, cleartext database connections and a
   loopback API host.
4. Run the migration once from the API service shell:

   ```sh
   npm run db:migrate --workspace @rosapay/api
   ```

   A second run must report no pending migrations.
5. Copy the API service's HTTPS URL (for example,
   `https://rosapay-api.onrender.com`) into the mobile app's Profile →
   Developer settings before installing the TestFlight build. The URL is
   persisted on the device and can be changed without rebuilding the app.

The API health response must report `storage: "postgres"`. If it reports
`"memory"`, stop: that instance would lose payment state on restart.

## Configuring a machine

The API, the worker and the Testnet proof scripts all read the same `.env` at
the repository root, through Node's own `--env-file-if-exists`. One file, one
place, no exported shell variables to forget:

```
cp .env.example .env
# then fill in DATABASE_URL, API_SESSION_SECRET,
# STELLAR_SETTLEMENT_CONTRACT_ID, STELLAR_RELAYER_SECRET and
# STELLAR_ADMIN_SECRET
```

Without `STELLAR_RELAYER_SECRET` the API answers `RELAYER_DISABLED` and the app
reports "The Lumenade Pay relayer is unreachable, so no fee payer could sign.
Nothing was sent." That is the fail-closed path working: no fee payer, no
transaction, nothing half-sent. It is also the most common reason a Testnet
payment stops at Prepare on a fresh checkout.

Secrets may also come from the Stellar CLI's identity store, which is the
fallback when no env file is present. The environment wins, because a stale
identity left in a repository-local `.stellar` after `stellar config migrate`
would otherwise be preferred over the real key.

## Secrets

`API_SESSION_SECRET`, `STELLAR_RELAYER_SECRET` and `STELLAR_ADMIN_SECRET` belong
in the platform secret store. The session secret must contain at least 32 random
bytes and authenticates the API's 15-minute bearer sessions. The Stellar keys
move real value: the relayer pays fees, and the admin registers merchants and
funds new wallets. They never belong in the repository or an image layer. The
API refuses to serve those endpoints when they are absent, so a deployment
without them degrades to read-only rather than failing in an unclear way.

Customer keys never appear here at all. They are generated in the device's secure
hardware and never leave it, which is why losing the server is not the same as
losing customer funds.

## Checklist

- [ ] `DATABASE_URL` points at the pooled connection for the API, a session
      connection for the worker, with `DATABASE_SSL=true`
- [ ] `npm run db:migrate` applied, and it reports no pending migrations on a
      second run
- [ ] `API_REQUIRE_DATABASE=true` so the API refuses to start on memory
- [ ] `API_SESSION_SECRET` is at least 32 random bytes and comes from the secret store
- [ ] `API_AUTH_REQUIRED=true` so every mutation requires a device session
- [ ] Relayer and admin secrets set from the secret store, and the relayer account
      funded
- [ ] `STELLAR_WALLET_WASM_HASH` set to the uploaded wallet contract
- [ ] Worker running with `WORKER_EVENT_START_LEDGER` if event scanning is wanted
- [ ] A shared rate-limit store before more than one API instance runs
