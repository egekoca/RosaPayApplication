# ADR 0002: Recovery and Signer Rotation Scope

- Status: Accepted for the Testnet demo; production gate remains open
- Date: 2026-08-21
- Scope: customer smart-wallet recovery and signer rotation

## Decision

The first Testnet demo is explicitly single-device. The passkey credential is
device-bound, private signing material is non-exportable, and Lumenade Pay does
not present a backup secret or custodial recovery path. Losing the device may
make the demo wallet inaccessible; the UI must describe this before wallet
creation and must never imply that the API can restore funds.

Production release is blocked until the account contract supports an explicit
rotation policy:

1. Add a second authenticator only after user presence on an already-authorized device.
2. Require a time-delayed rotation transaction and show pending and active signer sets.
3. Revoke the old signer only after the new signer is confirmed, with replay protection and an auditable on-chain event.
4. Provide an emergency path using at least two independent recovery factors; the relayer and API cannot initiate it alone.

Daily limits and merchant allowlists apply to both signers during the rotation
window. A rotation request cannot bypass payment policy.

## Consequences

- The demo validates the signing and settlement boundary without inventing a fake recovery mechanism.
- Native adapters expose only a credential identifier and public contract-account address, never an exportable private key.
- Account restoration, multi-device enrollment, and emergency recovery are release gates rather than hidden assumptions.

## Exit criteria

- A contract-account verifier and rotation entry point are selected and tested.
- Physical-device tests cover enrollment, cancellation, biometric failure, process death, rotation delay, and old-signer revocation.
- API authorization proves that no client-supplied role or relayer request can rotate a signer.
- Recovery events and active signer state are persisted and reconciled from Stellar RPC before the app reports success.
