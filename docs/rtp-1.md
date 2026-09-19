# RTP/1 Payment Intent

RTP/1 is the transport contract between a Lumenade Pay merchant and customer. It is optimized for QR: the payload is self-contained, human-readable after decoding, and independently verifiable before a wallet asks the customer to authorize anything.

## Shape

The signed payload contains:

- `version`: `RTP/1`
- `intentId`: ULID-like unique identifier
- `network`: `testnet` or `pubnet`
- merchant profile and signing key
- recipient Stellar address
- asset `{ type, code, decimals }`
- decimal `amount` (positive, no exponent, at most 7 fractional digits)
- optional human `reference`
- 32-byte `nonce`
- absolute `expiresAtLedger`
- UTC `createdAt`
- base64 Ed25519 `signature`

QR uses the URI scheme `rosapay://pay/<base64url-json>`. The payload is decoded, parsed with the Zod schema and policy-checked before signature verification. A QR is data, not authorization.

## Canonical signing

The merchant signs the SHA-256 digest of the canonical intent object (the object without `signature`). Canonical JSON is recursive:

- object keys are sorted lexicographically;
- arrays retain order;
- strings use JSON escaping;
- no insignificant whitespace is emitted;
- numbers are not used for monetary values.

The digest is prefixed with the legacy UTF-8 domain `RosaPay/RTP/1/PaymentIntent\0` by the protocol hash helper. This published compatibility identifier remains unchanged after the Lumenade Pay rebrand so existing signatures and test vectors stay valid. The signature is verified against the decoded StrKey merchant signing key. Any mutation to amount, recipient, nonce, expiry, network or asset changes the digest.

## Published test vector

The complete canonical input is `mockSignedIntent.intent` in `apps/mobile/src/features/payments/mockIntent.ts`.

```text
Merchant public key: GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57
RTP/1 digest:        5f907fc1e67ee7ac431a7163e7fd60ac99e9febd6943ade0acb1c796a6dcc803
Signature (base64):  cdxmPD/uQ7C8L+OTxyBjuzFFvNz0zbdCN+ZzRIDeKeEavKe3SwKZm6tE2f3YY/peILOGLCh1r6Jk+ayiP04uCw==
```

The corresponding private key is not stored in the repository.

## Validation order

Consumers should fail closed in this order:

1. Decode URI and size-limit the QR input.
2. Parse the exact schema and reject unknown protocol versions.
3. Validate network and asset policy against local configuration.
4. Reject expired intents and invalid ledger ranges.
5. Verify the merchant signature over the canonical intent hash.
6. Check that the user-visible confirmation matches the signed values.
7. Only then ask the secure signer for customer authorization.

The mobile fixture uses a real Ed25519 public key/signature pair and exercises amount tampering. Protocol tests also cover QR round trips, malformed signatures, unsupported networks and expiry.

## Replay protection

`intentId` and `nonce` are distinct. `intentId` identifies the user-facing request; `nonce` is the one-time authorization value used by settlement. The API uses an idempotency key for request retries. The Soroban contract persists a consumed intent ID and applies TTL so a previously accepted payment cannot be replayed.

## On-chain mapping

RTP/1 does not directly encode XDR or a contract invocation. The settlement adapter must construct a typed envelope with the exact network ID, settlement contract, customer, registered merchant, recipient, token, amount, nonce and expiry. The merchant then signs the contract digest. This prevents a valid QR signature from being replayed against a different contract or asset.

## Authorizing without a network

A customer's phone does not need a connection to take part in a payment. The
merchant is the side that is online, so it does the simulation and hands over
the one thing the customer has to sign.

**`UnsignedAuthRequest`** — what crosses to the customer:

| Field | Meaning |
| --- | --- |
| `version` | `RTP/1` |
| `networkPassphrase` | Which network this authorization is for |
| `settlementContractId` | The contract the invocation must name |
| `entryXdr` | The customer's unsigned `SorobanAuthorizationEntry`, base64 |
| `signatureExpirationLedger` | The ledger after which it is worthless |

**`PaymentAuthorization`** — what comes back: the same entry with the device's
signature and that expiry set in its credentials.

The customer cannot ask the network what it is signing, so it rebuilds the
expected invocation locally from the merchant-signed intent and compares it field
by field: contract, function, payer, amount, recipient, asset, expiry. A merchant
that swapped any of them produces an invocation that no longer matches the intent
it signed, and the device is never asked to sign. Verification happens before the
prompt, so an approval the customer sees is always for the payment on screen.

Ordering matters: the invocation names the payer, so the merchant can only build
the request once the customer has identified itself. Over a tap that is an extra
exchange — intent out, address back, request out, signature back — and the
protocol allows a second tap for it.

Proven on Testnet by `npm run testnet:offline`, which runs the customer's half
with `fetch` removed from its global scope, so reaching for the network fails
rather than passing unnoticed.
