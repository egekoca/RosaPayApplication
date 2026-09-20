# RTP/1 Payment Intent

RTP/1 is the transport contract between a Rosa Pay merchant and customer. It is optimized for QR: the payload is self-contained, human-readable after decoding, and independently verifiable before a wallet asks the customer to authorize anything.

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

The digest is prefixed with the UTF-8 domain `RosaPay/RTP/1/PaymentIntent\0` by the protocol hash helper. The signature is verified against the decoded StrKey merchant signing key. Any mutation to amount, recipient, nonce, expiry, network or asset changes the digest.

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
