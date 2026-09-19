# Rosa Pay

Rosa Pay is a non-custodial Stellar payment app for iOS and Android, built with React Native and TypeScript.

The product source of truth is [docs/PRD.md](docs/PRD.md), with implementation status tracked in [docs/TODO.md](docs/TODO.md). The implemented boundaries are documented in [architecture.md](docs/architecture.md), [rtp-1.md](docs/rtp-1.md), and [security-model.md](docs/security-model.md).

## Current Status

The foundation and first vertical slice are implemented:

- Bare React Native 0.85 app for iOS and Android, with one account and Customer/Merchant capability switching.
- English dark near-black, amber and restrained rose design system with a complete mocked QR request, scan, confirm and receipt flow.
- RTP/1 schema, QR codec, canonical hashing, merchant signature verification and policy tests.
- Stellar RPC adapter with live Testnet health checking.
- Typed RTP/1-to-settlement envelope conversion and a Stellar CLI-generated contract client binding.
- Fastify API boundary, idempotent intent service, database schema and worker foundation.
- Soroban settlement contract with customer auth, merchant signatures, asset policy, expiry and replay protection.

The settlement contract is deployed on Stellar Testnet as `CBX7XUIEFWMRBZBEJGZ7SJAFJXFCAB6VFJKOAFMUFAEXML2UVOAZFAQO`. It uses the verified deterministic native XLM SAC `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`. The optimized WASM is 7,320 bytes (`SHA-256 22b1d0638f6128407579e3993386fde7b0a2ed13494cccb49a3c080ddfe0ac7e`); public deployment and smoke-test evidence live under `config/`.

## Product Terms

- Product display name: `Rosa Pay`
- Application/package slug: `RosaPay`
- Customer and merchant capabilities live in one mobile application.
- Stellar Testnet is the first target network.

## Repository

```text
apps/
  mobile/          React Native application
  api/             Fastify API and database boundary
  worker/          Stellar background worker boundary
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

The next integration milestone is the native signer/passkey decision and replacement of the mocked mobile settlement adapter with generated-client simulation, authorization, submission and polling. Android NFC remains the final fast path and QR remains mandatory on both platforms.
