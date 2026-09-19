# Lumenade Pay

Lumenade Pay is a non-custodial Stellar payment app for iOS and Android, built with React Native and TypeScript.

Website: [lumenade-pay.vercel.app](https://lumenade-pay.vercel.app)

The product source of truth is [docs/PRD.md](docs/PRD.md), with implementation status tracked in [docs/TODO.md](docs/TODO.md). The implemented boundaries are documented in [architecture.md](docs/architecture.md), [rtp-1.md](docs/rtp-1.md), and [security-model.md](docs/security-model.md).

## Current Status

The foundation and first vertical slice are implemented:

- Bare React Native 0.85 app for iOS and Android, with one account and Customer/Merchant capability switching.
- Black, lemon-yellow and white brand system with an animated lemon/XLM mark across onboarding, camera startup and settlement loading states.
- RTP/1 schema, QR codec, canonical hashing, merchant signature verification and policy tests.
- Stellar RPC adapter with live Testnet health checking.
- Typed RTP/1-to-settlement envelope conversion and a Stellar CLI-generated contract client binding.
- Fastify API boundary, idempotent intent service, database schema and worker foundation.
- Soroban settlement contract with customer auth, merchant signatures, asset policy, expiry and replay protection.

The settlement contract is deployed on Stellar Testnet as `CBX7XUIEFWMRBZBEJGZ7SJAFJXFCAB6VFJKOAFMUFAEXML2UVOAZFAQO`. It uses the verified deterministic native XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`. The optimized WASM is 7,320 bytes (`SHA-256 22b1d0638f6128407579e3993386fde7b0a2ed13494cccb49a3c080ddfe0ac7e`); public deployment and smoke-test evidence live under `config/`.

## Product Terms

- Product display name: `Lumenade Pay`
- React Native component name: `LumenadePay`
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

The emulator demo needs no database and no API: mobile settlement runs in `mock`
Every payment settles on Stellar Testnet. The app needs the API and a
configured relayer to pay; without them it reports the failure rather than
recording anything locally.
Android emulator, forward the port with `adb reverse tcp:4100 tcp:4100`.

Set `DATABASE_URL` to use durable PostgreSQL storage instead, apply the
migrations, then start the reconciliation worker:

```bash
export DATABASE_URL=postgres://rosapay:rosapay@127.0.0.1:5432/rosapay
npm run db:migrate
npm run worker
```

`API_REQUIRE_DATABASE=true` refuses to start on memory, and
`API_AUTH_REQUIRED=true` rejects anonymous mutations. The worker only scans
contract events once `WORKER_EVENT_START_LEDGER` is set; see `.env.example`.

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
Secure Enclave and Face ID only exist on a real device, so this is also the only
way to exercise the hardware signer for real.

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

The smart wallet has its own proof, where a P-256 device key authorizes a wallet
operation through `__check_auth`:

```bash
npm run testnet:wallet
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
[lumenade-pay.vercel.app](https://lumenade-pay.vercel.app) from `apps/web`. The
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

The current integration uses a device-controlled smart wallet, generated-client
simulation, authorization, relayer submission and final-status polling. The next
public milestone is physical-device validation and a remotely hosted API/worker;
QR remains mandatory on both platforms and Android NFC is an optional fast path.
