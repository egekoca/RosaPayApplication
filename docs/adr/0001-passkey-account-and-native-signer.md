# ADR 0001: Passkey Account Model and Native Signer Boundary

- Status: Accepted for the first production-quality Testnet demo
- Date: 2026-08-21
- Scope: customer wallet authorization and Soroban contract-account signing

## Context

Lumenade Pay must keep signing material out of JavaScript while allowing a customer
to approve an exact RTP/1 payment. The settlement contract requires a separate
customer authorization from the merchant RTP/1 signature. The mobile app is a
bare React Native application, so browser-only WebAuthn storage is not an
acceptable implementation boundary.

The Stellar dApp guidance identifies two maintained passkey account models:

- Smart Account Kit: OpenZeppelin context rules plus an auth digest.
- Passkey Kit: a flat multi-signer `Signatures` map.

Lumenade Pay needs policy hooks for merchant verification, payment expiry, maximum
single payment, daily spending limits, and future signer rotation. A flat
signer map does not provide that policy boundary by itself.

## Decision

Use a Soroban contract account compatible with the Smart Account Kit /
OpenZeppelin context-rule model. The first policy set is:

1. Only verified merchant intents can be authorized.
2. The on-chain intent expiry must be within the RTP/1 expiry bound.
3. A single-payment limit is enforced before user presence is requested and
   again by the contract policy.
4. Daily limits and signer rotation are reserved policy versions, not hidden
   client-side assumptions.

Use a provider-neutral native signer bridge in React Native. The bridge owns
passkey credential creation, secure storage, user-presence prompts, and signing.
JavaScript receives only public identity metadata, signed auth-entry XDR, signed
transaction XDR, and typed errors. The app does not import browser
`IndexedDBStorage` or claim that a browser WebAuthn package is React Native
compatible.

The TypeScript port exposes two Stellar SDK-compatible operations:

- `signAuthEntry`: customer authorization for Soroban non-invoker auth entries.
- `signTransaction`: only for transactions explicitly assigned to the customer;
  the relayer remains the fee-payer when the flow uses fee sponsorship.

`authorizePayment` remains the UX-level operation. It performs the exact intent
confirmation and user-presence step before the lower-level signing operation.

## Consequences

Positive:

- Policy and account semantics fit Lumenade Pay’s merchant and spending controls.
- iOS Keychain/Secure Enclave and Android Keystore remain replaceable native
  implementations behind one stable TypeScript port.
- Generated Stellar contract clients can use the same `signAuthEntry` shape as
  SEP-43-compatible wallets.
- No secret key, passkey private material, or raw biometric data crosses into
  JavaScript or the API database.

Costs and constraints:

- A real native WebAuthn/passkey module is still required on both platforms.
- The account verifier and contract-account deployment must be selected and
  tested before real customer settlement is enabled.
- A simulator can validate navigation and error states, but physical-device
  passkey/user-presence behavior remains a release gate.

## Rejected alternatives

- Browser Smart Account Kit storage: incompatible with the React Native native
  storage boundary and not sufficient proof of iOS/Android passkey support.
- Passkey Kit as the first account model: useful for flat signer sets, but does
  not directly express Lumenade Pay’s required spending and merchant policies.
- Keeping a JavaScript private key: violates the non-custodial security model.
- Treating the RTP/1 merchant signature as customer authorization: the two
  signatures cover different trust boundaries and must remain separate.

## Exit criteria for implementation

- Native iOS and Android adapters create or restore a device-bound credential.
- `getIdentity` returns a public contract-account address and credential ID only.
- `signAuthEntry` returns valid signed auth-entry XDR or a typed cancellation /
  biometric / locked-out error.
- Generated-client simulation, authorization, relayer submission, and polling
  pass on Testnet without `settleMockPayment`.

