# Rosa Pay

Rosa Pay is a non-custodial Stellar payment app for iOS and Android, built with React Native and TypeScript.

Website: [rosa-pay-app.vercel.app](https://rosa-pay-app.vercel.app)

The product source of truth is [docs/PRD.md](docs/PRD.md), with implementation status tracked in [docs/TODO.md](docs/TODO.md). The implemented boundaries are documented in [architecture.md](docs/architecture.md), [rtp-1.md](docs/rtp-1.md), [security-model.md](docs/security-model.md), [anchor-integration.md](docs/anchor-integration.md), [swap-funding.md](docs/swap-funding.md), and [passkeys.md](docs/passkeys.md). The architecture is drawn in [architecture-diagrams.md](docs/architecture-diagrams.md), and the skill files this was built with are recorded in [skills-used.md](docs/skills-used.md).

## Current Status

The foundation and first vertical slice are implemented:

- Bare React Native 0.85 app for iOS and Android, with one account and Customer/Merchant capability switching.
- Black, amber and white brand system with an animated rose mark across onboarding, camera startup and settlement loading states.
- RTP/1 schema, QR codec, canonical hashing, merchant signature verification and policy tests.
- Stellar RPC adapter with live Testnet health checking.
- Typed RTP/1-to-settlement envelope conversion and a Stellar CLI-generated contract client binding.
- Fastify API boundary, idempotent intent service, database schema and worker foundation.
- Soroban settlement contract with customer auth, merchant signatures, asset policy, expiry and replay protection.
- Soroswap-funded settlement: a customer holding none of the token the merchant asked for pays anyway, because the contract buys the exact amount through the AMM in the same transaction.
- A smart wallet that outlives the phone that made it: a Secure Enclave key signs payments, a passkey the platform syncs across the owner's devices is registered as the recovery signer, and a lost handset is rotated out from a new one.
- Merchant QR requests expire after 60 ledgers (about five minutes) by default; the protocol factory also rejects longer caller-supplied lifetimes. A reader accepts up to 72, because the merchant, the API and the customer each read `latestLedger` from their own RPC poll and a receiver a few ledgers behind must not reject an honest request.
- The API rechecks that same policy against live Stellar Testnet before storing an intent, so an expired or long-lived crafted request is rejected rather than becoming a durable QR/NFC offer.
- NFC carries the exact RTP/1 URI: Android merchants publish it over HCE, Android and iPhone customers can tap to open Confirm, and an NFC tap starts one biometric/device authorization automatically. QR remains the fallback; iPhone merchants cannot publish HCE.
- A small SEP-12 customer-information client and deterministic in-memory mock anchor are included for the hackathon walkthrough. It demonstrates `NEEDS_INFO` -> `ACCEPTED` without persisting identity values and is not production KYC.

The settlement contract is deployed on Stellar Testnet as `CAV65DKNKPQZMY2MBXEDDBBCLMTVNIZUJVYFNDRUSKNCATIFKX66CSVO`. It uses the verified deterministic native XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` and routes funding swaps through the Soroswap router `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD`. The WASM is 11,301 bytes (`SHA-256 b7fa54ae6f14cf76854977e4ba9d8e6da0957c4a5cb211a9c2f34d0f8ef85a4b`); public deployment and smoke-test evidence live under `config/`. The previous deployment was `CBX7XUIEFWMRBZBEJGZ7SJAFJXFCAB6VFJKOAFMUFAEXML2UVOAZFAQO`, which has no funding-swap entry point.

## Product Terms

- Product display name: `Rosa Pay`
- React Native component name: `RosaPay`
- Customer and merchant capabilities live in one mobile application.
- Stellar Testnet is the first target network.

Published compatibility identifiers remain unchanged for this release: the
`@rosapay/*` workspace scope, native `RosaPaySigner` bridge, `ROSAPAY_*`
environment variables, `com.rosapay` bundle identifiers, `rosapay://` QR scheme,
and RTP/1 signing domain. Renaming them would invalidate existing app storage,
QR links, signatures, and deployment evidence.

## Repository

```text
apps/
  mobile/          React Native application
  api/             Fastify API and database boundary
  worker/          Stellar background worker boundary
  web/             Public product and Testnet evidence website
packages/
  domain/          Payment state machine
  protocol/        RTP/1 types, validation, canonicalization and QR codec
  secure-signer/   Native signer interface
  stellar/         RPC and signature adapter
  ui/              Shared design tokens and components
contracts/
  settlement/      Soroban settlement contract
scripts/
  deploy-testnet.sh
```

## Prerequisites

- Node.js `>=22.11` and npm `>=11`
- Xcode and CocoaPods for iOS
- JDK 17, Android SDK 36 and the matching NDK for Android
- Rust stable with the `wasm32v1-none` target
- Stellar CLI `27.x`

## Install and Run

```bash
npm ci
cd apps/mobile/ios
pod install
cd ../../..
```

Start Metro at `http://localhost:8081`:

```bash
npm start
```

Run a native app in another terminal:

```bash
npm run ios
```

For the supplied emulators, use the platform-specific commands below. Android
needs the SDK path in the shell and a reverse Metro port; iOS uses the named
Simulator directly from the mobile workspace:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
adb reverse tcp:8081 tcp:8081
npm run android

cd apps/mobile
npx react-native run-ios --simulator 'iPhone 17 Pro'
cd ../..
```

For Android on macOS, expose the local SDK first:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
npm run android
```

Start the API at `http://localhost:4100`:

```bash
npm run api
```

The payment demo is Testnet-first: it uses the API, a configured relayer and
the deployed settlement contract; without them it reports the failure and never
records a local success. On the Android emulator, forward the API port with
`adb reverse tcp:4100 tcp:4100`.

The standalone SEP-12 walkthrough is intentionally local and deterministic:
`packages/anchor` exposes `createMockSep12Anchor`, `getCustomerInfo` and
`submitCustomerInfo`. It is useful for demonstrating the anchor hand-off, but
it is not a KYC provider and must not receive real identity documents.

Run that proof with:

```bash
npm run test --workspace @rosapay/anchor
npm run demo:sep12
```

Set `DATABASE_URL` to use durable PostgreSQL storage instead, apply the
migrations, then start the reconciliation worker:

```bash
export DATABASE_URL=postgres://rosapay:rosapay@127.0.0.1:5432/rosapay
npm run db:migrate
npm run worker
```

`API_REQUIRE_DATABASE=true` refuses to start on memory. With a 32-byte-or-longer
`API_SESSION_SECRET`, the API verifies a single-use P-256 device challenge and
issues a 15-minute bearer session; `API_AUTH_REQUIRED=true` then rejects every
anonymous mutation. The worker only scans contract events once
`WORKER_EVENT_START_LEDGER` is set; see `.env.example`.

### Real Testnet settlement from the app

The mobile app settles on Testnet through a relayer that pays the fee. Give the
API a funded relayer account and the contract admin, then start it on an address
the emulator can reach:

```bash
export STELLAR_RELAYER_SECRET=$(stellar keys show rosapay-testnet-relayer --config-dir .stellar)
export STELLAR_ADMIN_SECRET=$(stellar keys show rosapay-testnet-deployer --config-dir .stellar)
API_HOST=0.0.0.0 npm run api
adb reverse tcp:4100 tcp:4100    # Android emulator
```

In the app, open **Developer settings** from the home header, switch the
settlement mode to **Testnet**, then create a business profile (it is registered
on-chain) and pay a request.

### Testing on a real phone

Neither platform needs a paid developer account to run the app on your own device.

**Android** — no account at all. Enable Developer options and USB debugging on the
phone, connect it, and `npm run android` installs directly. Point Metro and the
API at your machine over the cable:

```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:4100 tcp:4100
```

**iOS** — a free Apple ID is enough. Open `apps/mobile/ios/RosaPay.xcworkspace`,
select the RosaPay target, and under Signing & Capabilities pick your personal
team; Xcode then provisions the device. A free signing identity expires after
seven days, so the app has to be reinstalled after that, and the device has to
trust the certificate under Settings → General → VPN & Device Management. The
Face ID only exists on a real device, so this is also the only way to exercise
the payment prompt for real.

There is no `adb reverse` on iOS, so the phone reaches the API over the network:
run it with `API_HOST=0.0.0.0 npm run api`, then set the address in the app's
**Developer settings → API address** to your machine's LAN address, for example
`http://192.168.1.10:4100`. The same field works on Android over Wi-Fi. The relayed settlement path is also verifiable
without the app:

```bash
npx tsx scripts/testnet-relayed-settlement.mts
```

It asserts on-chain that the relayer is the transaction source and fee payer,
that the customer is debited the amount only, and writes the evidence to
`config/testnet-relayed-evidence.json`.

The production smart wallet has its own proof, where a non-exportable P-256
device key authorizes a wallet operation through `__check_auth` while a relayer
pays the fee:

```bash
npm run testnet:wallet
```

The lira rail has one too. `npm run testnet:try-ramp` runs a full round trip
against the anchor through the standards door only — SEP-1 discovery, SEP-10
auth, SEP-38 for the rate, SEP-6 for the transfer, and no API key — buying USDC
with lira and selling it back to an IBAN, and writes the result to
`config/testnet-try-ramp-evidence.json`:

```bash
npm run testnet:try-ramp
```

The passkey and recovery paths have proofs that need no phone, because the
platform half is the only part a simulator cannot stand in for:

```bash
npm run testnet:passkey     # a real WebAuthn assertion authorizes the wallet
npm run testnet:recovery    # a lost phone is rotated out by the recovery passkey
npm run testnet:bridge      # a smart wallet uses the lira ramp, both directions
```

The Soroswap funding path has a proof of its own. It settles a USDC-priced
request from a smart wallet whose USDC balance is zero, and asserts on-chain
that the merchant received the exact signed amount, that the customer kept no
leftover balance, that the spend stayed under the ceiling the device signed for,
and that the router really was inside the same transaction:

```bash
npm run testnet:swap
```

## Verify

```bash
npm run check
npm run lint
npm run contract:test
npm run contract:build
npm audit
```

The owner of the project-local Testnet identities can also run the live XLM settlement and negative-path smoke suite:

```bash
npm run testnet:smoke
```

## Deploying

The static product website is deployed at
[rosa-pay-app.vercel.app](https://rosa-pay-app.vercel.app) from `apps/web`. The
mobile source and reproducible Testnet evidence are linked from that page; it
does not imply an App Store or Play Store release.

The API and worker are long-lived processes and the database is plain
PostgreSQL; see [docs/deployment.md](docs/deployment.md) for what each one needs,
why that backend is not a serverless deployment, and the checklist to go live.

## Stellar Agent Tooling

This repository enables the Stellar Raven MCP server through
`.codex/config.toml`. `AGENTS.md` requires Stellar work to use the matching
`stellar-dev:*` skill, Raven's skill playbooks, and current Stellar
documentation before network-sensitive implementation decisions.

After trusting the project, start a new Codex session in the repository and
verify the server:

```bash
codex mcp get stellar-raven --json
```

The result must show `enabled: true` and
`https://raven.stellar.buzz/mcp`. Project-specific Stellar rules, security
invariants, and verification commands are documented in `AGENTS.md`.

## Testnet Deployment

Configure a Stellar CLI Testnet identity and pass only public addresses through the deployment environment:

```bash
ROSAPAY_DEPLOYER=<cli-identity> \
ROSAPAY_ADMIN=<G-or-C-address> \
ROSAPAY_XLM_SAC=<verified-native-SAC-address> \
ROSAPAY_STELLAR_CONFIG_DIR=<optional-cli-config-dir> \
./scripts/deploy-testnet.sh
```

The current integration uses the device-controlled `C...` smart wallet with
generated-client simulation, hardware authorization, relayer submission and
final-status polling. The recovery-phrase classic-account adapter is explicitly
experimental and is never selected by the production payment path. The next
public milestone is physical-device validation and a remotely hosted API/worker;
QR remains available on both platforms. Android can publish NFC and accept taps
while Rosa Pay is in the foreground; a verified tap starts the device's
biometric authorization without an extra in-app approval button. It never
bypasses that device prompt. iPhone customers can read an Android merchant's
NFC request after starting Core NFC from the scan screen; iPhones cannot publish
over NFC because iOS withholds card emulation from third-party apps. Merchant
QRs are shown only after the API confirms the same signed request and expire
after 60 ledgers (about five minutes). The Android merchant HCE service is
unlock-required and stops when the app backgrounds or the request is paid or
expired.
