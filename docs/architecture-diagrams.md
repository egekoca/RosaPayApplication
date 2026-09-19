# Architecture

Four diagrams, each answering a question the prose takes a page to answer.

## 1. Who is allowed to do what

The whole design is one idea: **three parties sign three different things, and no
one of them can do another's job.** The merchant says what is owed. The customer
says they will pay it. The relayer pays the network fee and submits. The contract
is the only thing that decides whether any of it happened.

```mermaid
sequenceDiagram
    autonumber
    actor M as Merchant phone
    actor C as Customer phone
    participant R as Relayer
    participant S as Settlement contract
    participant X as Soroswap router

    M->>M: sign the intent<br/>(recipient, asset, amount, nonce, expiry)
    M-->>C: QR or NFC
    C->>C: verify the merchant signature
    C->>S: simulate
    S-->>C: authorization entry
    C->>C: Face ID → sign that entry only
    C->>R: hand over the signed entry
    R->>R: add the fee signature<br/>cannot alter the entry
    R->>S: submit
    S->>S: expiry · network · contract · merchant<br/>recipient · asset · replay
    opt customer holds a different token
        S->>X: swap_tokens_for_exact_tokens(amount_out = the signed amount)
        X-->>S: exact amount bought
    end
    S->>S: transfer customer → recipient
    S-->>R: PaymentSettled
```

A compromised relayer can refuse to submit. It cannot change the recipient, the
asset, the amount, or who pays — those are inside a signature it does not hold.

## 2. Where the keys live, and why there are three

A Stellar classic account signs ed25519, and no Secure Enclave will hold an
ed25519 key. That single fact produces everything below.

```mermaid
flowchart TB
    subgraph phone["The phone"]
        DK["Device key<br/>secp256r1, Secure Enclave / Keystore<br/><i>cannot leave the chip</i>"]
        PK["Passkey<br/>secp256r1, WebAuthn<br/><i>platform syncs it across devices</i>"]
        BK["Bridge key<br/>ed25519, software<br/><i>holds nothing at rest</i>"]
    end

    subgraph chain["Stellar"]
        W["Smart wallet<br/>contract account C…"]
        A["Anchor<br/>sees accounts, not contracts"]
    end

    DK -->|signs payments| W
    PK -->|"rotate() only"| W
    BK -->|SEP-10, deposits, payouts| A
    BK <-->|sweep| W

    classDef hw fill:#2C2008,stroke:#E0B45D,color:#fff
    classDef sw fill:#1a1a18,stroke:#7D786D,color:#fff
    class DK,PK hw
    class BK sw
```

The device key is safest and dies with the handset. The passkey is equally
unreachable but the platform replicates it, so it is the recovery signer — and
the contract restricts a key that is *only* the recovery signer to `rotate`, so
it can rescue the wallet and never spend from it. The bridge key is the one piece
of software-held key material, and it is deliberately worthless: it is not backed
up, and a lost one is replaced.

## 3. Lira in, lira out

The anchor cannot see a contract account: it authenticates accounts, refuses a
contract address as a destination, and matches withdrawals from a payments stream
that a contract transfer never appears in. So money passes through the bridge and
never rests there.

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

    classDef fiat fill:#10100F,stroke:#25231E,color:#fff
    class BANK,AN fiat
```

Solid is money in, dotted is money out. **A deposit is not settled while it is
still on the bridge**, whatever the anchor calls the transfer — the same rule as
a claimable balance, and for the same reason.

## 4. What runs where

```mermaid
flowchart TB
    subgraph client["React Native"]
        UI["Screens"]
        SIGN["Native signers<br/>RosaPaySigner · RosaPayPasskey"]
    end
    subgraph server["Node"]
        API["Fastify API<br/>sessions · intents · relayer · wallets"]
        WK["Worker<br/>reconciles settled payments"]
        DB[("PostgreSQL")]
    end
    subgraph soroban["Soroban"]
        SET["Settlement contract"]
        WAL["Wallet contract"]
        SOR["Soroswap router"]
    end

    UI --> SIGN
    UI -->|"intents, relayer, wallets"| API
    UI -->|"simulate, submit"| SET
    API --> DB
    WK --> DB
    WK -->|"PaymentSettled events"| SET
    API -->|"fee signature only"| SET
    SET --> WAL
    SET --> SOR
```

The API never holds a signing key that can spend a customer's money. It holds the
relayer key, which pays fees, and the admin key, which registers merchants and
assets. Both are useless for moving someone else's balance.

## Verifying these

Every path above has a script that runs it against the live network and asserts
the claims rather than printing them:

| | |
|---|---|
| `npm run testnet:relayed` | the three-signature separation in diagram 1 |
| `npm run testnet:swap` | the Soroswap branch, 17 assertions |
| `npm run testnet:passkey` | the passkey signer in diagram 2, and four refusals |
| `npm run testnet:recovery` | `rotate` from a lost phone, and that recovery cannot spend |
| `npm run testnet:bridge` | both directions of diagram 3 |
| `npm run testnet:try-ramp` | the same rails from a classic account |
