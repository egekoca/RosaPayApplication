# Rosa Pay — Stellar Pro Hackathon Submission

**Team:** Ege Yenikale (Full Stack Developer) · Caner Yakupoğlu (Product Manager)
**Network:** Stellar Testnet · **Protocol version at last check:** 28

---

## 1. The Narrative "Why"

### What are you building?

Rosa Pay is the Web3 replacement for Turkey's digital meal-card networks — Pluxee,
Edenred, Multinet, Setcard, Metropol. It is a non-custodial React Native app where
the same counter interaction happens (the customer pays, the merchant is paid) but
on Stellar rails instead of a closed four-party card scheme.

Three things happen that a meal card cannot do:

1. The merchant is paid the instant the ledger closes, and can withdraw or stake
   immediately instead of waiting out a 30-day settlement term.
2. The customer pays with whatever asset they hold. If the merchant asked for USDC
   and the wallet holds only XLM, the settlement contract buys the exact amount
   through Soroswap inside the same transaction.
3. The payment can be handed over by QR, by contactless (NFC host-card emulation
   or Bluetooth LE), or completely offline with no network on either phone.

### What problem does it solve?

Turkey's meal-card market is large, mature, and structurally extractive. The two
costs sit on the merchant, and both are documented by the regulator rather than
claimed by us:

- **Commission.** The Perakende Ticaret yönetmeliği has capped meal-card commission
  at 6% since 2018. Real rates reach 10%. In August 2025 the Ministry of Trade fined
  the five largest issuers 15.8M TRY for breaching that ceiling.
- **Settlement delay.** The same regulation caps payout at 30 days (explicit since
  1 January 2024). The wait itself is a financing cost: roughly 4 TRY on every 100 TRY
  at a ~48% annual cost of working capital.

A restaurant therefore loses **10–14 TRY of every 100 TRY** it takes on a meal card.

On the customer side the card is locked to lira, effectively locked to QR, and is
dead outside Turkey.

### Who are your target users?

Three parties, because a meal card is not a two-sided product:

- **Merchants** — restaurants and cafés first. 53,000 of Turkey's ~60,000 meal-card
  acceptance points are restaurants, so that is the launch wedge.
- **Employees** — the cardholders. ~3.8M on a single issuer; 330 TRY is loaded per
  employee per working day under the 2026 income-tax exemption.
- **Employers** — the party that actually funds the balance. They are the buyer in
  this market, and the reason the category exists at all (the daily meal allowance
  is income-tax and stamp-duty exempt when paid this way).

### Why is this problem worth solving?

The behaviour is already finished. Nobody has to be taught to pay for lunch with a
card app in Turkey — millions do it every working day across 60,000 acceptance
points. We are not creating a market or a habit; we are replacing the rails under
one that already runs at scale.

It is also early rather than saturated: meal-card penetration is ~11% of employees
in Turkey against ~25% across the EU.

And the incumbent's weakness is a matter of public record. When the Ministry of
Trade is fining the five largest issuers for overcharging, the thesis "this
category's economics are wrong" does not need us to argue it.

### What is your value proposition?

> **The same lunch, the same counter — paid instantly, at 1%.**

| | Meal card today | Rosa Pay |
| --- | --- | --- |
| Merchant payout | 30 days | The moment the ledger closes |
| Merchant fee | 6–10% | 1% |
| Idle balance | Earns for the issuer | Withdraw, or stake it |
| Customer currency | Lira only | Any asset held, swapped in the payment |
| Handover | QR only | QR, contactless, or fully offline |
| Outside Turkey | Invalid | Settles in local currency through an anchor |

Non-custodial throughout: the signing key is generated in the Secure Enclave or
StrongBox and never leaves the phone.

---

## 2. Your MVP

| Deliverable | Location |
| --- | --- |
| Public GitHub repository | https://github.com/egekoca/RosaPayApplication |
| README | [`README.md`](../README.md) |
| Front-end / application | https://rosapay-mobile.vercel.app |
| Live API | https://rosapay-api.onrender.com |
| API health | `/v1/health` · `/v1/health/stellar` |
| Deployment manifest | [`config/testnet-deployment.json`](../config/testnet-deployment.json) |
| Pitch deck | [`docs/deck/RosaPay-Stellar-Pro-Hackathon.pptx`](deck/RosaPay-Stellar-Pro-Hackathon.pptx) |

### Deployed contracts and artifacts (Stellar Testnet)

| Artifact | ID |
| --- | --- |
| Settlement contract | `CAV65DKNKPQZMY2MBXEDDBBCLMTVNIZUJVYFNDRUSKNCATIFKX66CSVO` |
| Settlement WASM SHA-256 | `b7fa54ae6f14cf76854977e4ba9d8e6da0957c4a5cb211a9c2f34d0f8ef85a4b` (11,301 bytes) |
| WASM upload tx | `1fc729ceda6cef4e6428e8a4743ff837f1be17d9b2e203f3f18729306935d1c7` |
| Deployment tx | `528664cba30b44a5d1d37208f097765e47e74c521a9feefba77ec16e315a2ba7` (ledger 4,540,659) |
| Smart-wallet WASM SHA-256 | `2c4d82af6757bb990ea1d8d69b8a9561aaf29f5279b34ffcb80dadd21d577165` |
| Native XLM SAC (verified) | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| USDC SAC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Soroswap router | `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD` |
| Soroswap factory | `CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY` |
| Network passphrase | `Test SDF Network ; September 2015` |

### Evidence — every claim has a transaction behind it

Each is reproducible from a JSON file committed under `config/`.

| What it proves | Transaction | File |
| --- | --- | --- |
| End-to-end settlement | `3d18ead525af980d0e2d32f721c90d20ed6a3f442f63e101e3d960464ebb3989` | `testnet-smoke-evidence.json` |
| Fee-relayed payment — the customer needs no XLM for fees | `f1f850aa24d55172bde1bef9428110554cffcdcdb1507bad8cd50cf987d49396` | `testnet-relayed-evidence.json` |
| An XLM-only smart wallet settles a 0.1 USDC bill through Soroswap, in one approval | `ccfdaa238967a99d1bcfd3534c7e2e0c193dae585aa3a0c622f3f35a3230a53b` | `testnet-swap-evidence.json` |
| A passkey authorizes the smart wallet | `6208731aecf16315d4a46878e6b09f873d16c010dde81468889d59d90eaa4f6b` | `testnet-passkey-evidence.json` |
| A lost phone is rotated out by its recovery passkey, from a new device | `2ed61aba82b4331ae0992d74d335deff6b61e7ce7abea6dc0009382200ee599d` | `testnet-recovery-evidence.json` |
| Lira round trip through a SEP-6 anchor, fee disclosed before withdrawal | in `aea02853f64aeea9841a6817a1c926401002999593d55dc89e79cccf0f704a8c` / out `d1a4534299c3944ede91c9c335e83eb2f030373049214df69c3e467ffd82544f` | `testnet-try-ramp-evidence.json` |
| Contract-account ↔ anchor bridge (see §3 trade-offs) | `6daa0ddc49e0fadeb7970addc633fdebc05b67e377bd234ec8a56915dcaa6369` | `testnet-bridge-evidence.json` |

### What is real and what is mocked

Stated plainly, so judges do not have to discover it:

- **Real:** the settlement contract, the smart wallet, Soroswap funding swaps, the
  fee relayer, passkey recovery, the API and its PostgreSQL persistence, and all
  transactions above — all on Stellar Testnet.
- **Mocked:** the TRY anchor is our own deterministic mock (`tr-mock-anchor.fly.dev`)
  because no licensed TRY anchor exists on Testnet, and the SEP-12 client speaks to
  an in-memory mock that demonstrates `NEEDS_INFO → ACCEPTED` without persisting
  identity values. **It is not production KYC.**

---

## 3. Technical Documentation

Full detail lives in the README and in `docs/architecture.md`, `docs/rtp-1.md`,
`docs/security-model.md`, `docs/anchor-integration.md`, `docs/swap-funding.md` and
`docs/passkeys.md`. Summary:

### Overall architecture

```text
React Native app (iOS + Android, New Architecture)
  -> packages/domain      payment state machine, no I/O
  -> packages/protocol    RTP/1 schema, canonical JSON, QR codec, policy validation
  -> packages/stellar     RPC adapter, generated contract client, signature verification
  -> packages/secure-signer  the only signing port (Swift / Kotlin P-256 behind biometrics)

Fastify API -> repository port -> PostgreSQL adapter (in-memory adapter for local)
Worker      -> RPC health, submitted-settlement confirmation, contract-event reconciliation
Soroban settlement contract -> asset policy -> customer auth -> merchant payment
```

Dependencies point inward. `protocol` and `domain` import no React Native, no
Fastify and no Stellar transport code, so the rules that decide whether a payment
is valid are testable without a network or a device.

### Main components and their responsibilities

| Component | Responsibility |
| --- | --- |
| `packages/protocol` | RTP/1 request schema, canonical JSON, deterministic intent hashing, QR URI codec, expiry/policy validation |
| `packages/domain` | The payment state machine: `awaiting_approval → authorized → submitted → confirmed`. Pure; accepts events, returns the next state |
| `packages/stellar` | RPC configuration, the generated settlement client, RTP/1 → settlement envelope mapping, StrKey validation, merchant signature verification |
| `packages/secure-signer` | The single signing port. Native adapters return public keys and signatures only — never key material |
| `packages/postgres` | Driver-neutral PostgreSQL port plus a pooled, transaction-capable adapter shared by API and worker |
| `apps/mobile` | Navigation, capability switching (one account is both customer and merchant), transports (QR / NFC / BLE / offline), device sessions |
| `apps/api` | Fastify transport, request validation, idempotency, challenge-response auth, intent storage |
| `apps/worker` | Confirms settlements against RPC receipts; reconciles contract events as an audit signal |
| `contracts/settlement` | Soroban policy: approved assets, customer authorization, merchant signature, expiry, on-chain replay protection, Soroswap funding |

### Stellar integrations and protocols used

- **Soroban SDK** — the settlement contract and the smart-wallet contract.
- **Stellar Asset Contracts** — the verified deterministic native XLM SAC and the
  USDC SAC as settled assets.
- **Soroswap** — the AMM router invoked from inside the settlement call so a funding
  swap and the payment are one atomic transaction.
- **SEP-10** — challenge-response authentication against the anchor.
- **SEP-45** — contract-account authentication, needed because a smart wallet cannot
  sign a classic SEP-10 challenge.
- **SEP-6 / SEP-38** — anchor deposits, withdrawals and quotes for the lira leg.
- **SEP-12** — customer information exchange (mock; see above).
- **WebAuthn / passkeys** — a platform-synced passkey enrolled as the wallet's
  recovery signer, verified on-chain as secp256r1 over `authenticatorData ||
  SHA-256(clientDataJSON)`.

### Key design decisions and trade-offs

**A bare React Native app, not Expo.** Secure native signing, platform key storage,
Android HCE and BLE peripheral mode need native modules. The trade-off is a heavier
build and no Expo Go; we took it because the signing key is the product's security
boundary and it cannot live behind a managed runtime.

**The merchant signs the request; the customer signs the payment.** The customer's
phone verifies the merchant signature *offline* before showing anything. This is
what makes the offline mode safe: the request is self-authenticating, so a customer
with no network can still tell a real request from a forged one.

**Bluetooth LE alongside NFC.** iOS grants no third-party card emulation, so an
iPhone merchant cannot publish over HCE and iPhone-to-iPhone contactless is
impossible with NFC alone. BLE carries the identical signed payload in every
direction. Native code filters on signal strength so only a nearby merchant is
offered; a sustained touching-strength reading raises the device prompt by itself.
Neither path bypasses the biometric prompt — the payment key is minted so the
hardware refuses to sign without it.

**Confirmation only from an RPC receipt.** A successful *submission* is not a
payment. `StellarRpcClient.confirmTransaction` rejects malformed hashes,
`NOT_FOUND`, `FAILED` and incomplete success responses; only the worker, holding a
final `SUCCESS`, may move a settlement to `confirmed`.

**Expiry asymmetry: write 60 ledgers, accept 72.** Merchant requests expire after
60 ledgers (~5 minutes) and the protocol factory rejects longer caller-supplied
lifetimes. A *reader* accepts up to 72, because merchant, API and customer each
read `latestLedger` from their own RPC poll, and a receiver a few ledgers behind
must not reject an honest request. Writing strict and reading tolerant is the
trade-off that keeps the clock skew from becoming a failed payment.

**A relayer pays the network fee.** A new customer holding no XLM must still be
able to pay. The relayer submits and is charged; the customer authorizes. The
trade-off is an operational account to fund and monitor.

### Technical challenges and how we solved them

**1. A customer holding the wrong asset.** A meal-card user should never see "you
don't hold USDC". The settlement contract takes the customer's asset, routes it
through the Soroswap router and delivers the merchant's exact requested amount —
in the same transaction, so either the merchant is paid in full or nothing moves.
Proven on chain: an XLM-only smart wallet settling a 0.1 USDC bill.

**2. A smart wallet cannot talk to an anchor.** Three separate walls, all real:
SEP-10 authenticates an *account* and a contract cannot sign a classic challenge;
every SEP-6 endpoint requires `account` to be a `G...` address; and Soroban
transactions cannot carry a memo, so a SAC transfer arrives at Horizon without the
one field the anchor uses to identify a deposit. We solved it with a per-user
bridge account: a classic `G...` account that authenticates, receives and forwards,
sitting between the contract wallet and the anchor. The trade-off is one extra
account and one extra hop, documented in `docs/anchor-integration.md`.

**3. Losing the phone must not lose the money.** The device key is non-exportable
by design, which makes device loss fatal unless a second signer exists. At wallet
creation we enrol a platform-synced passkey as a recovery signer. From a new phone,
the passkey authorizes rotating the lost device key out and the new one in — proven
on chain, transaction `2ed61aba…599d`.

**4. Paying with no signal.** The request is a signed, self-contained payload with
its own expiry and nonce; the customer's phone verifies and signs it without a
network; the merchant — who does have connectivity — submits. Replay is blocked
on-chain by the contract rather than by anything the offline device has to track.

**5. Clock skew between three independent RPC readers.** Solved by the write-60 /
read-72 asymmetry described above.

---

## 4. Pitch Presentation

Built on the official Stellar Pro Hackathon template
(`2026_09 Pro Hackathon Presentation Template.pptx`), keeping its Georgia
typography, cream-on-near-black palette and gradient grounds.

**File:** [`docs/deck/RosaPay-Stellar-Pro-Hackathon.pptx`](deck/RosaPay-Stellar-Pro-Hackathon.pptx) — 10 slides.

1. Cover
2. The Problem
3. The Solution
4. PMF
5. Technical Workflow
6. Built on Stellar
7. MVP: Live on Testnet
8. Proven on Chain
9. Status & Next
10. The Team

---

## Sources for the market and regulatory figures

- Perakende Ticarette Uygulanacak İlke ve Kurallar Hakkında Yönetmelik — 6% commission
  ceiling (in force since 22 May 2018); 30-day payout limit (explicit from 1 January 2024).
- Ministry of Trade, August 2025 — 15.8M TRY in administrative fines to the five
  largest meal-card issuers for exceeding the commission ceiling.
- YEKADER (Yemek Kartı Hizmetleri Derneği) — ~60,000 acceptance points (53,000
  restaurants, 7,000 local markets), sector growth 12–15%/yr.
- Pluxee Türkiye — published user count (3.8M) and acceptance network.
- Resmî Gazete, 31 December 2025 — 2026 daily meal allowance exemption: 330 TRY by card.

Note: aggregate sector *volume* figures in public circulation date from 2022–23,
when the daily exemption was 110 TRY against 330 TRY today. We deliberately do not
quote them, and the deck uses only the acceptance-point and per-issuer numbers,
which are current.
