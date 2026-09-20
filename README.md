<div align="center">

<img src="apps/web/assets/rosapay-logo.png" width="104" alt="Rosa Pay" />

# Rosa Pay

**A non-custodial Stellar payment app for iOS and Android.**

Scan. Approve. Settled.

[![React Native](https://img.shields.io/badge/React_Native-0.85-0D0D0C?style=flat-square&logo=react&logoColor=61DAFB)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-0D0D0C?style=flat-square&logo=typescript&logoColor=3178C6)](https://www.typescriptlang.org)
[![Soroban](https://img.shields.io/badge/soroban--sdk-27.0.6-0D0D0C?style=flat-square&logo=rust&logoColor=E0B45D)](https://developers.stellar.org/docs/build/smart-contracts)
[![Stellar](https://img.shields.io/badge/Stellar-Testnet-0D0D0C?style=flat-square&logo=stellar&logoColor=FFFFFF)](https://stellar.expert/explorer/testnet/contract/CAV65DKNKPQZMY2MBXEDDBBCLMTVNIZUJVYFNDRUSKNCATIFKX66CSVO)
[![iOS](https://img.shields.io/badge/iOS-Secure_Enclave-0D0D0C?style=flat-square&logo=apple&logoColor=FFFFFF)](#where-the-keys-live-and-why-there-are-three)
[![Android](https://img.shields.io/badge/Android-SDK_36-0D0D0C?style=flat-square&logo=android&logoColor=3DDC84)](#where-the-keys-live-and-why-there-are-three)
[![Tests](https://img.shields.io/badge/tests-370_passing-0D0D0C?style=flat-square)](#verify)

[**Product site**](https://rosapay-mobile.vercel.app) · [**API health**](https://rosapay-api.onrender.com/v1/health) · [**Settlement contract**](https://stellar.expert/explorer/testnet/contract/CAV65DKNKPQZMY2MBXEDDBBCLMTVNIZUJVYFNDRUSKNCATIFKX66CSVO) · [**Architecture deep dive**](docs/architecture.md)

</div>

---

## This is a mobile app

Worth saying plainly, because most Stellar submissions are web dApps and the distinction changes the whole design.

Rosa Pay is a bare React Native 0.85 build for iOS and Android, not a browser wallet in a phone-shaped viewport and not an Expo project. It ships Swift and Kotlin modules because the things it needs do not exist in JavaScript: Secure Enclave and Android Keystore key generation, biometric-gated signing, WebAuthn passkeys, Android host card emulation, Core NFC, and a BLE peripheral that advertises a signed payment request. The site at [rosapay-mobile.vercel.app](https://rosapay-mobile.vercel.app) is the product page for that app. The app is what this repository builds.

<table>
<tr>
<td width="50%" align="center"><img src="apps/web/assets/merchant-request.png" width="260" alt="Merchant payment request screen" /><br/><sub><b>Merchant</b> · signs a request, shows it as QR, NFC or BLE</sub></td>
<td width="50%" align="center"><img src="apps/web/assets/customer-confirm.png" width="260" alt="Customer confirmation screen" /><br/><sub><b>Customer</b> · verifies the signature, then Face ID</sub></td>
</tr>
</table>

One account is both. A person installs the app, and a switch in the header turns the same wallet into a merchant terminal.

---

## What it does at the counter

A customer walks up. The merchant's phone puts a signed request on screen or in the air. The customer's phone reads it, verifies the merchant's signature before showing a single number, and asks for a fingerprint. About one ledger close later, roughly five seconds on Testnet, the merchant has the money.

No address is typed. No seed phrase appears on screen. The customer never needs XLM to pay a network fee, and never needs to hold the token the merchant asked for.

| Capability | How it works |
|:--|:--|
| **Three transports, one payload** | QR on both platforms, NFC where the OS allows it, and Bluetooth LE for the iPhone-to-iPhone case that NFC cannot do. All three carry the identical signed RTP/1 URI. |
| **Pays with no signal** | The request is self-authenticating, so a customer with a dead connection can still tell a real request from a forged one, sign it, and hand it back for the merchant to submit. |
| **Pays in the wrong token** | An XLM-only wallet settles a USDC bill. The contract buys the exact amount through Soroswap inside the same transaction, so either the merchant is paid in full or nothing moves. |
| **Pays with no XLM** | A relayer is the transaction source and fee payer. It cannot alter the recipient, the asset or the amount, because those sit inside a signature it does not hold. |
| **Survives a lost phone** | The device key is non-exportable and dies with the handset. A platform-synced passkey, enrolled at wallet creation, rotates the lost key out from a new phone. |
| **Lira in, lira out** | A full SEP-6 round trip through the standards door: SEP-1 discovery, SEP-10 auth, SEP-38 quote, no API key. |

---

## Overall architecture

Four processes and one chain. The mobile app is the only place a customer's key material exists, the API is the only place a relayer key exists, and the contract is the only thing that decides whether a payment happened.

```mermaid
flowchart TB
    subgraph client["React Native 0.85 · iOS + Android"]
        UI["Screens<br/>onboarding · home · pay · merchant · activity"]
        SIGN["Native modules<br/>RosaPaySigner · RosaPayPasskey<br/>RosaPayNfc · RosaPayProximity"]
    end
    subgraph server["Node 22 · Fastify"]
        API["API<br/>sessions · intents · relayer · wallets"]
        WK["Worker<br/>confirms receipts · reconciles events"]
        DB[("PostgreSQL")]
    end
    subgraph soroban["Soroban · Stellar Testnet"]
        SET["Settlement contract"]
        WAL["Smart wallet contract"]
        SOR["Soroswap router"]
    end

    UI --> SIGN
    UI -->|"intents · relayer · wallets"| API
    UI -->|"simulate · submit"| SET
    API --> DB
    WK --> DB
    WK -->|"PaymentSettled events"| SET
    API -->|"fee signature only"| SET
    SET --> WAL
    SET --> SOR

    classDef m fill:#2C2008,stroke:#E0B45D,color:#fff
    classDef s fill:#141412,stroke:#7D786D,color:#fff
    class UI,SIGN m
    class API,WK,DB,SET,WAL,SOR s
```

Inside the TypeScript workspace, dependencies point inward:

```text
apps/mobile ─┐
apps/api    ─┼─→ packages/stellar ──→ packages/protocol ──→ packages/domain
apps/worker ─┘         │                      │                    │
                  RPC · client         schema · canonical      state machine
                  StrKey · verify      JSON · QR codec         (no I/O at all)
```

`protocol` and `domain` import no React Native, no Fastify and no Stellar transport code. The rules that decide whether a payment is valid run in a unit test with no network and no device, which is the only reason the offline path could be tested at all.

---

## The payment, end to end

The whole design is one idea: three parties sign three different things, and none of them can do another's job. The merchant says what is owed. The customer says they will pay it. The relayer pays the network fee and submits.

```mermaid
sequenceDiagram
    autonumber
    actor M as Merchant phone
    actor C as Customer phone
    participant R as Relayer · API
    participant S as Settlement contract
    participant X as Soroswap router

    M->>M: sign the intent<br/>(recipient, asset, amount, nonce, expiry)
    M-->>C: QR · NFC · BLE
    C->>C: verify the merchant signature<br/><i>offline, before showing a number</i>
    C->>S: simulate
    S-->>C: authorization entry
    C->>C: Face ID → sign that entry only
    C->>R: hand over the signed entry
    R->>R: add the fee signature<br/><i>cannot alter the entry</i>
    R->>S: submit
    S->>S: expiry · network · contract · merchant<br/>recipient · asset · replay
    opt customer holds a different token
        S->>X: swap_tokens_for_exact_tokens(amount_out = signed amount)
        X-->>S: exact amount bought
    end
    S->>S: transfer customer → recipient
    S-->>R: PaymentSettled
```

A compromised relayer can refuse to submit. It cannot change who gets paid, in what, or how much.

---

## Main components and their responsibilities

| Component | Responsibility |
|:--|:--|
| `apps/mobile` | Navigation, capability switching, the four transports (QR, NFC, BLE, offline), device sessions, auto-lock. 26,700 lines of TypeScript plus Swift and Kotlin. |
| `apps/api` | Fastify transport, Zod validation, idempotency, single-use P-256 challenge auth, intent storage, relayer submission. 22 routes under `/v1`. |
| `apps/worker` | Confirms settlements against an RPC receipt and reconciles `PaymentSettled` events as an independent audit signal. |
| `packages/protocol` | RTP/1 schema, canonical JSON, deterministic intent hashing, the `rosapay://` QR codec, expiry and policy validation. |
| `packages/domain` | The payment state machine: `awaiting_approval → authorized → submitted → confirmed`. Pure. Accepts an event, returns the next state. |
| `packages/stellar` | RPC configuration, the generated settlement client, RTP/1 to settlement-envelope mapping, StrKey validation, merchant signature verification. |
| `packages/secure-signer` | The single signing port. Native adapters return public keys and signatures. Never key material. |
| `packages/postgres` | Driver-neutral port plus a pooled, transaction-capable adapter shared by API and worker. |
| `packages/anchor` | SEP-12 client and a deterministic in-memory mock anchor for the walkthrough. |
| `packages/ui` | Design tokens and shared components. Black, amber, white, with an animated rose mark. |
| `contracts/settlement` | Asset policy, customer authorization, merchant signature check, expiry, on-chain replay protection, Soroswap funding. 11,301 bytes of WASM. |
| `contracts/wallet` | The smart account: secp256r1 signers, `__check_auth`, recovery-signer enrolment, `rotate`. |

---

## Built on Stellar

| Protocol | Where it is used |
|:--|:--|
| **Soroban SDK 27.0.6** | The settlement contract and the smart-wallet contract, both Rust, both on Testnet. |
| **Stellar Asset Contracts** | The verified deterministic native XLM SAC and the USDC SAC as settled assets. |
| **Soroswap** | The AMM router, invoked from inside the settlement call so a funding swap and the payment are one atomic transaction. |
| **SEP-10** | Challenge-response authentication against the anchor, from the classic bridge account. |
| **SEP-45** | Contract-account authentication, needed because a smart wallet cannot sign a classic SEP-10 challenge. |
| **SEP-38** | Firm quotes for the lira leg, with the fee disclosed before the customer commits. |
| **SEP-6** | Anchor deposit and withdrawal for TRY. |
| **SEP-12** | Customer information exchange, `NEEDS_INFO → ACCEPTED`. Mock, see [what is real](#what-is-real-and-what-is-mocked). |
| **WebAuthn / secp256r1** | A platform-synced passkey verified on-chain over `authenticatorData ‖ SHA-256(clientDataJSON)`. |

### Deployed on Testnet

| Artifact | Address |
|:--|:--|
| Settlement contract | [`CAV65DKN…KX66CSVO`](https://stellar.expert/explorer/testnet/contract/CAV65DKNKPQZMY2MBXEDDBBCLMTVNIZUJVYFNDRUSKNCATIFKX66CSVO) |
| Settlement WASM | `b7fa54ae6f14cf76854977e4ba9d8e6da0957c4a5cb211a9c2f34d0f8ef85a4b` · 11,301 bytes |
| Smart-wallet WASM | `2c4d82af6757bb990ea1d8d69b8a9561aaf29f5279b34ffcb80dadd21d577165` |
| Native XLM SAC | [`CDLZFC3S…VU2HHGCYSC`](https://stellar.expert/explorer/testnet/contract/CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC) |
| USDC SAC | [`CBIELTK6…CIHMXQDAMA`](https://stellar.expert/explorer/testnet/contract/CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA) |
| Soroswap router | [`CCJUD55A…O264UZZE7BRD`](https://stellar.expert/explorer/testnet/contract/CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD) |

Full manifest, including the upload and deployment transactions, is in [`config/testnet-deployment.json`](config/testnet-deployment.json).

---

## Where the keys live, and why there are three

A Stellar classic account signs ed25519. No Secure Enclave will hold an ed25519 key. That single fact produces everything below.

```mermaid
flowchart TB
    subgraph phone["The phone"]
        DK["Device key<br/>secp256r1 · Secure Enclave / Keystore<br/><i>cannot leave the chip</i>"]
        PK["Passkey<br/>secp256r1 · WebAuthn<br/><i>platform syncs it across devices</i>"]
        BK["Bridge key<br/>ed25519 · software<br/><i>holds nothing at rest</i>"]
    end

    subgraph chain["Stellar"]
        W["Smart wallet<br/>contract account C…"]
        A["Anchor<br/>sees accounts, not contracts"]
    end

    DK -->|"signs payments"| W
    PK -->|"rotate() only"| W
    BK -->|"SEP-10 · deposits · payouts"| A
    BK <-->|"sweep"| W

    classDef hw fill:#2C2008,stroke:#E0B45D,color:#fff
    classDef sw fill:#141412,stroke:#7D786D,color:#fff
    class DK,PK hw
    class BK sw
```

The device key is the safest and it dies with the handset. The passkey is equally unreachable, but the platform replicates it, so it is the recovery signer. The contract restricts a key that is *only* a recovery signer to `rotate`, so it can rescue the wallet and never spend from it. The bridge key is the one piece of software-held key material, and it is deliberately worthless: never backed up, and a lost one is replaced.

---

## Design decisions and trade-offs

**Bare React Native, not Expo.** Secure native signing, platform key storage, Android HCE and BLE peripheral mode all need native modules. The cost is a heavier build, a longer first setup and no Expo Go. We took it because the signing key is the product's security boundary, and a managed runtime cannot hold that boundary.

**The merchant signs the request; the customer signs the payment.** Two separate signatures over two separate things. The customer's phone verifies the merchant signature before it renders a single digit, which is what makes the offline mode safe: the request authenticates itself, so a phone with no network can still tell a real request from a forged one. The cost is that a merchant needs a key and an on-chain registration before taking the first payment.

**Bluetooth LE alongside NFC, not instead of it.** iOS grants no third-party card emulation, so an iPhone merchant cannot publish over HCE and iPhone-to-iPhone contactless is impossible with NFC alone. BLE carries the identical signed payload in every direction. Native code filters on signal strength so only a nearby merchant is offered, and a sustained reading at touching strength raises the device prompt by itself, exactly as a tap does. Neither path skips biometrics: the payment key is minted so the hardware refuses to sign without it. The cost is a second transport to maintain and two sets of platform permissions.

**Confirmation comes from an RPC receipt, never from a successful submission.** `StellarRpcClient.confirmTransaction` rejects malformed hashes, `NOT_FOUND`, `FAILED` and incomplete success responses. Only the worker, holding a final `SUCCESS`, may move a settlement to `confirmed`. The cost is that the app shows a pending state for a few seconds where a naive client would have shown a tick.

**Write 60 ledgers, accept 72.** Merchant requests expire after 60 ledgers, about five minutes, and the protocol factory rejects any longer caller-supplied lifetime. A *reader* accepts up to 72. Merchant, API and customer each read `latestLedger` from their own RPC poll, and a receiver a few ledgers behind must not reject an honest request. Writing strict and reading tolerant is what keeps clock skew from becoming a failed payment.

**A relayer pays the network fee.** A new customer holding no XLM must still be able to pay, which is the entire point of a meal card. The relayer is the transaction source and is charged; the customer only authorizes. The cost is an operational account to fund, monitor and rate-limit.

**The API holds no key that can spend a customer's money.** It holds the relayer key, which pays fees, and the admin key, which registers merchants and assets. Both are useless for moving someone else's balance. That property is what let us put the API on a shared host at all.

---

## Technical challenges, and how we solved them

### 1. The customer holds the wrong asset

A meal-card user should never read "you do not hold USDC". So the settlement contract takes whatever the customer does hold, routes it through the Soroswap router with `swap_tokens_for_exact_tokens`, and delivers the merchant's exact requested amount. Same transaction. Either the merchant is paid in full or nothing moves at all.

```mermaid
flowchart LR
    A["Customer wallet<br/>0 USDC · XLM only"] -->|"one Face ID"| B["settle_payment_with_swap"]
    B -->|"amount_out = signed amount"| C["Soroswap router"]
    C -->|"exact USDC"| B
    B -->|"transfer"| D["Merchant<br/>paid in USDC"]
    classDef n fill:#141412,stroke:#7D786D,color:#fff
    classDef h fill:#2C2008,stroke:#E0B45D,color:#fff
    class A,C,D n
    class B h
```

The device signs a spend ceiling, not a blank cheque, so a bad quote fails the transaction rather than draining the wallet. Proven on chain: an XLM-only smart wallet settling a 0.1 USDC bill, in transaction [`ccfdaa23…0a53b`](https://stellar.expert/explorer/testnet/tx/ccfdaa238967a99d1bcfd3534c7e2e0c193dae585aa3a0c622f3f35a3230a53b). `npm run testnet:swap` reruns it and asserts 17 separate claims.

### 2. A smart wallet cannot talk to an anchor

Three separate walls, all real, and we hit them in order. SEP-10 authenticates an *account*, and a contract cannot sign a classic challenge. Every SEP-6 endpoint requires `account` to be a `G...` address. Soroban transactions cannot carry a memo, so a SAC transfer reaches Horizon without the one field the anchor uses to match a deposit.

The fix is a per-user bridge account: a classic `G...` that authenticates, receives and forwards, sitting between the contract wallet and the anchor. Money passes through and never rests there.

```mermaid
flowchart LR
    BANK[("Turkish bank<br/>FAST / EFT")]
    AN["Anchor<br/>SEP-1 · 10 · 38 · 6"]
    BR["Bridge G…"]
    SW["Smart wallet C…"]

    BANK -->|"TRY + reference"| AN
    AN -->|"classic payment"| BR
    BR -->|"SAC transfer"| SW

    SW -.->|"SAC transfer"| BR
    BR -.->|"payment + memo id"| AN
    AN -.->|"TRY to IBAN"| BANK

    classDef n fill:#141412,stroke:#7D786D,color:#fff
    class BANK,AN,BR,SW n
```

Solid is money in, dotted is money out. A deposit is not settled while it is still sitting on the bridge, whatever the anchor calls the transfer. The trade-off is one extra account and one extra hop per user.

### 3. Losing the phone must not lose the money

The device key is non-exportable by design, which makes device loss fatal unless a second signer exists before the loss. At wallet creation the app enrols a platform-synced passkey as a recovery signer. From a new phone, that passkey authorizes `rotate`, which removes the dead device key and installs the new one. The recovery signer cannot spend, only rotate, so enrolling it does not widen the attack surface.

Proven on chain in [`2ed61aba…ee599d`](https://stellar.expert/explorer/testnet/tx/2ed61aba82b4331ae0992d74d335deff6b61e7ce7abea6dc0009382200ee599d). `npm run testnet:recovery` reruns it, including the four refusals that prove the recovery key cannot move money.

### 4. Paying with no signal

The RTP/1 request is a signed, self-contained payload carrying its own expiry and a 32-byte nonce. The customer's phone verifies the merchant signature and signs the authorization entry without touching the network. The merchant, who does have connectivity, submits. Replay is blocked on-chain by the contract's consumed-intent set rather than by anything the offline device has to remember, which matters because an offline device can be restored from a backup.

### 5. Clock skew between three independent RPC readers

Three parties poll three different RPC endpoints and read three slightly different `latestLedger` values. Early on this produced payments that a healthy merchant had created and a healthy customer then rejected as expired. The write-60 / read-72 asymmetry above is the fix, and it is enforced in both the protocol factory and the consumer-side policy so neither side can widen it alone.

### 6. Keeping the security rules out of the phone

Every rule that decides whether a payment is valid lives in `packages/protocol` and `packages/domain`, which import nothing platform-specific. Expiry, canonical hashing, the QR codec, policy limits and the state machine are covered by 26 tests that need no network and no simulator, and the whole pair runs in under a second. Testing that logic through a simulator instead would have made the offline path effectively untestable.

---

## Proof on chain

Every claim above has a transaction behind it, and a script that reruns it against live Testnet and asserts the result rather than printing it.

| What it proves | Script | Transaction |
|:--|:--|:--|
| End-to-end settlement | `npm run testnet:smoke` | [`3d18ead5…b3989`](https://stellar.expert/explorer/testnet/tx/3d18ead525af980d0e2d32f721c90d20ed6a3f442f63e101e3d960464ebb3989) |
| The customer needs no XLM for fees | `npm run testnet:relayed` | [`f1f850aa…49396`](https://stellar.expert/explorer/testnet/tx/f1f850aa24d55172bde1bef9428110554cffcdcdb1507bad8cd50cf987d49396) |
| An XLM-only wallet settles a USDC bill | `npm run testnet:swap` | [`ccfdaa23…0a53b`](https://stellar.expert/explorer/testnet/tx/ccfdaa238967a99d1bcfd3534c7e2e0c193dae585aa3a0c622f3f35a3230a53b) |
| A passkey authorizes the smart wallet | `npm run testnet:passkey` | [`6208731a…a4f6b`](https://stellar.expert/explorer/testnet/tx/6208731aecf16315d4a46878e6b09f873d16c010dde81468889d59d90eaa4f6b) |
| A lost phone is rotated out from a new one | `npm run testnet:recovery` | [`2ed61aba…ee599d`](https://stellar.expert/explorer/testnet/tx/2ed61aba82b4331ae0992d74d335deff6b61e7ce7abea6dc0009382200ee599d) |
| Lira round trip, fee disclosed before withdrawal | `npm run testnet:try-ramp` | [`aea02853…04a8c`](https://stellar.expert/explorer/testnet/tx/aea02853f64aeea9841a6817a1c926401002999593d55dc89e79cccf0f704a8c) |
| Contract account reaches the anchor through the bridge | `npm run testnet:bridge` | [`6daa0ddc…a6369`](https://stellar.expert/explorer/testnet/tx/6daa0ddc49e0fadeb7970addc633fdebc05b67e377bd234ec8a56915dcaa6369) |

Each script writes its assertions to a JSON file under [`config/`](config), committed alongside the code.

---

## What is real and what is mocked

Stated up front, so nobody has to discover it.

**Real, on Stellar Testnet:** the settlement contract, the smart wallet, Soroswap funding swaps, the fee relayer, passkey enrolment and recovery, the Fastify API with PostgreSQL persistence, and every transaction linked above.

**Mocked:** the TRY anchor is our own deterministic mock at `tr-mock-anchor.fly.dev`, because no licensed TRY anchor exists on Testnet. The SEP-12 client speaks to an in-memory mock that demonstrates `NEEDS_INFO → ACCEPTED` without persisting any identity value. It is not production KYC and must never receive real identity documents.

---

## Repository layout

```text
apps/
  mobile/          React Native app · iOS (Swift) + Android (Kotlin) native modules
  api/             Fastify API, sessions, intents, relayer, wallet registry
  worker/          Receipt confirmation and contract-event reconciliation
  web/             The static product site deployed to Vercel
packages/
  protocol/        RTP/1 schema, canonical JSON, hashing, QR codec, policy
  domain/          Payment state machine, no I/O
  stellar/         RPC adapter, generated contract client, signature verification
  secure-signer/   The signing port, implemented natively per platform
  postgres/        Pooled adapter shared by API and worker
  anchor/          SEP-12 client and the deterministic mock anchor
  ui/              Design tokens and shared components
contracts/
  settlement/      Soroban settlement contract (Rust)
  wallet/          Soroban smart account with secp256r1 signers and rotation
scripts/           Live-Testnet proofs, deployment, evidence writers
config/            Deployment manifest and committed on-chain evidence
docs/              Architecture, security model, deployment
```

---

## Running it

### Prerequisites

Node `>=22.11` and npm `>=11`, Xcode with CocoaPods for iOS, JDK 17 with Android SDK 36 and the matching NDK for Android, Rust stable with the `wasm32v1-none` target, and Stellar CLI `27.x`.

### Install

```bash
npm ci
cd apps/mobile/ios && pod install && cd ../../..
```

### Start Metro and a device

```bash
npm start                       # Metro on :8081

npm run ios                     # iOS Simulator
# or a named simulator:
cd apps/mobile && npx react-native run-ios --simulator 'iPhone 17 Pro'
```

Android needs the SDK on the path and a reverse port, because the emulator does not share the host's localhost:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
adb reverse tcp:8081 tcp:8081
npm run android
```

### Start the API

```bash
npm run api                     # http://localhost:4100
adb reverse tcp:4100 tcp:4100   # Android emulator only
```

The payment demo is Testnet-first. It uses the API, a configured relayer and the deployed contract, and if any of them is missing it reports the failure rather than recording a local success.

For durable storage, point it at PostgreSQL and start the worker:

```bash
export DATABASE_URL=postgres://rosapay:rosapay@127.0.0.1:5432/rosapay
npm run db:migrate
npm run worker
```

`API_REQUIRE_DATABASE=true` refuses to start on memory. With a 32-byte-or-longer `API_SESSION_SECRET` the API verifies a single-use P-256 device challenge and issues a 15-minute bearer session, and `API_AUTH_REQUIRED=true` then rejects every anonymous mutation. The worker scans contract events only once `WORKER_EVENT_START_LEDGER` is set. See [`.env.example`](.env.example).

### Settling for real from the app

Give the API a funded relayer and the contract admin, then bind it to an address the phone can reach:

```bash
export STELLAR_RELAYER_SECRET=$(stellar keys show rosapay-testnet-relayer --config-dir .stellar)
export STELLAR_ADMIN_SECRET=$(stellar keys show rosapay-testnet-deployer --config-dir .stellar)
API_HOST=0.0.0.0 npm run api
```

In the app, open **Developer settings** from the home header, switch settlement to **Testnet**, create a business profile (it registers on-chain), and pay a request.

### On a real phone

Neither platform needs a paid developer account, and a real device is the only way to exercise Face ID, HCE and BLE for real.

**Android** needs no account at all. Enable developer options and USB debugging, connect the cable, run `npm run android`, then `adb reverse` both ports as above.

**iOS** needs a free Apple ID. Open `apps/mobile/ios/RosaPay.xcworkspace`, select the RosaPay target, pick your personal team under Signing & Capabilities, and Xcode provisions the device. A free signing identity expires after seven days, so the app has to be reinstalled after that, and the device has to trust the certificate under Settings → General → VPN & Device Management.

There is no `adb reverse` on iOS, so the phone reaches the API over the network. Run `API_HOST=0.0.0.0 npm run api` and set **Developer settings → API address** to your machine's LAN address, for example `http://192.168.1.10:4100`. The same field works for Android over Wi-Fi.

---

## Verify

```bash
npm run check            # typecheck + 342 TypeScript tests across 45 files
npm run lint
npm run contract:test    # 28 Rust tests
npm run contract:build
npm audit
```

The live-network proofs in the table above need Testnet identities and a funded relayer. `npm run testnet:smoke` runs the settlement path plus the negative cases.

---

## Deploying

The product site is deployed from `apps/web` to [rosapay-mobile.vercel.app](https://rosapay-mobile.vercel.app). It links the source and the reproducible evidence, and it does not imply an App Store or Play Store release.

The API and worker are long-lived processes and the database is plain PostgreSQL, which is why this backend is not a serverless deployment. [`docs/deployment.md`](docs/deployment.md) has the requirements for each process and the checklist to go live.

Deploying the contract yourself needs a Stellar CLI Testnet identity, and only public addresses pass through the environment:

```bash
ROSAPAY_DEPLOYER=<cli-identity> \
ROSAPAY_ADMIN=<G-or-C-address> \
ROSAPAY_XLM_SAC=<verified-native-SAC-address> \
./scripts/deploy-testnet.sh
```

---

## Deeper reading

| Document | What it covers |
|:--|:--|
| [`docs/architecture.md`](docs/architecture.md) | Every boundary in detail: package responsibilities, the smart wallet, signing and passkeys, transports, state, the RTP/1 to settlement mapping, pricing in a currency no anchor quotes. |
| [`docs/security-model.md`](docs/security-model.md) | Trust boundaries, the invariants the contract enforces, and what an attacker gets from each compromised component. |
| [`docs/deployment.md`](docs/deployment.md) | What the API, worker and database each need in production, and the go-live checklist. |
