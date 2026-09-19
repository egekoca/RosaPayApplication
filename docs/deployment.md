# Deploying Rosa Pay

## What has to run

Rosa Pay is a long-lived Node server, a reconciliation loop and a database.
The loop is a separate *process* only when you choose to deploy it as one.

| Process | Shape | Why |
| --- | --- | --- |
| `@rosapay/api` | Long-lived HTTP server | Holds the relayer and admin Stellar keys, keeps a PostgreSQL pool, and waits on the ledger while a settlement confirms |
| `@rosapay/worker` | Long-lived loop | Reconciles submitted settlements against RPC receipts and expires abandoned requests on an interval, with graceful shutdown. Runs inside the API or beside it — see [Where the reconciliation loop runs](#where-the-reconciliation-loop-runs) |
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

- **Which connection string.** Use the session pooler. It is reachable over
  IPv4, where the direct connection is IPv6-only and often unroutable from a
  host; and it keeps the prepared statements and transactions that migrations
  and a connection held across a reconciliation cycle both need, which the
  transaction pooler does not. Set `DATABASE_MAX_CONNECTIONS` low per instance —
  the pool multiplies by instance count, and a pooler has a hard ceiling.
- **TLS, and the certificate authority.** Set `DATABASE_SSL=true`; the client
  then verifies the certificate rather than trusting anything that answers.
  Supabase signs its poolers with `Supabase Root 2021 CA`, which is in no system
  trust store, so verification fails with `SELF_SIGNED_CERT_IN_CHAIN` until the
  root is supplied as `DATABASE_CA_CERT` — download it from Database → SSL
  Configuration. The advice everywhere else is `rejectUnauthorized: false`,
  which does not weaken verification so much as remove it: the connection stays
  encrypted and becomes willing to encrypt to anyone who answers. That is the
  wrong trade for payment records, so it is not offered here.

  Nothing connects until the first query, so getting this wrong does not stop
  the service starting. It starts, reports its configured storage mode, and
  fails when someone actually pays.
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
as they are written.

### Where the reconciliation loop runs

The loop is `startReconciler` in `apps/worker/src/reconciler.ts`, and both the
standalone service and the API start the same one. Where it runs is a
deployment decision rather than a code change:

- **Inside the API** (`WORKER_IN_PROCESS=true`) is the default in `render.yaml`.
  Nothing connects *to* the loop — it reads settlements from PostgreSQL and asks
  RPC what became of them, both outbound — so it needs no service of its own,
  and it borrows the API's pool instead of opening a second. Hosts charge for a
  background worker while giving the web service away, and for demo volumes that
  bill buys nothing. On a host that sleeps an idle instance this stays correct
  for the case that matters: the submit which creates work to reconcile is
  itself the request that wakes the instance.
- **As its own service** (`npm run start --workspace @rosapay/worker`) once
  traffic justifies it, so it can restart without interrupting payments and so a
  long RPC cycle cannot compete with request handling. Set `WORKER_IN_PROCESS`
  to false and `WORKER_STANDALONE=true` so `deploy:check` knows to stop asking.

What is not a choice is running neither. A settlement only ever reaches
`confirmed` in this loop, so without it every payment sits at `submitted`: the
money moves, the merchant's screen never says so, and nothing reports an error.
`deploy:check` fails when neither is configured. Nor may it be replaced with a
sleeping cron job — confirmation and expiry need a continuous loop.

The repository includes a Docker image and a Render blueprint. With the loop in
process the whole backend is Render's free web service plus a free Supabase or
Neon database, which is the smallest production-shaped deployment for a
TestFlight group.

### Render + Supabase/Neon

1. Create a PostgreSQL project and copy its TLS connection string. Prefer the
   provider's session pooler: it is reachable over IPv4, and it holds the
   prepared statements and transactions that migrations and a long-lived pool
   need. A separate session/direct connection is only needed when the worker
   runs as its own service.
2. Create a Render Blueprint from this repository. `render.yaml` creates
   `rosapay-api` with the reconciliation loop inside it; enter the database URL
   and the Testnet secrets where requested.
3. Before deploying, validate the environment without printing any secret:

   ```sh
   npm run deploy:check
   ```

   Every check must be `true`. The command intentionally rejects a missing
   session secret, in-memory storage, cleartext database connections and a
   loopback API host.
4. Run the migration once, from a machine that has the repository. Render's
   free instances have no shell, and the API does not migrate on boot, so this
   is not a step the deployment performs for you:

   ```sh
   DATABASE_URL="<the hosted connection string>" DATABASE_SSL=true \
     npm run db:migrate
   ```

   The inline variable wins over anything in `.env`. A second run must report
   `"applied": []`.
5. Write the API service's HTTPS URL into `apiBaseUrl` in
   `config/testnet-deployment.json` and rebuild the app. That file is the
   build's default, so this is what gives a TestFlight tester a working install
   without touching any setting. Profile → Developer settings overrides it per
   device and survives a restart, which is for a developer pointing one phone
   somewhere else — not something a tester should have to do.

The API health response must report `storage: "postgres"`. If it reports
`"memory"`, stop: that instance would lose payment state on restart.

### Before a demo, wake the instance

```sh
npm run api:warm
```

A free instance is stopped after fifteen minutes without a request, and
starting it again takes thirty to forty-five seconds. Every request arriving
during that start-up waits for it, so this is not something the app can hide
on its own: `useApiWarmup` fires a health check at launch, but a customer who
opens the app and pays ten seconds later lands mid-start and waits out the
rest. The only way nobody sees it is for the instance to be up before the
first person touches the app.

Once it is up it stays up: the app pings every ten minutes while it is open,
inside the fifteen-minute window. A five-minute demo therefore needs one warm
call beforehand and nothing after.

What this cannot remove is the ledger. Testnet closes a ledger every five
seconds, so a payment reads as `submitted` at once and reaches `confirmed` on
the next close — that wait is Stellar's, not the host's, and paying for an
always-on instance would not shorten it. If cold starts have to be impossible
rather than merely avoidable — an unattended TestFlight group rather than a
demo you are standing in front of — that is the point to leave the free plan.
Keeping a free instance awake around the clock is not the alternative: the
750 monthly instance-hours run out before the month does.

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
reports "The Rosa Pay relayer is unreachable, so no fee payer could sign.
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

- [ ] `DATABASE_URL` points at the provider's session pooler, with
      `DATABASE_SSL=true`
- [ ] `npm run db:migrate` applied, and it reports no pending migrations on a
      second run
- [ ] `API_REQUIRE_DATABASE=true` so the API refuses to start on memory
- [ ] `API_SESSION_SECRET` is at least 32 random bytes and comes from the secret store
- [ ] `API_AUTH_REQUIRED=true` so every mutation requires a device session
- [ ] Relayer and admin secrets set from the secret store, and the relayer account
      funded
- [ ] `STELLAR_WALLET_WASM_HASH` set to the uploaded wallet contract
- [ ] `WORKER_IN_PROCESS=true`, or a separate worker service with
      `WORKER_STANDALONE=true` — without one of them nothing ever reaches
      `confirmed`
- [ ] `WORKER_EVENT_START_LEDGER` set if contract-event scanning is wanted
- [ ] A shared rate-limit store before more than one API instance runs
