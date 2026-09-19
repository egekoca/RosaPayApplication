# ADR 0002: Recovery and Signer Rotation Scope

- Status: Superseded in part on 2026-09-07 — single-device is no longer the shape
  of this wallet. Recovery and multi-device enrolment are implemented and proven
  on Testnet; the remaining production gates below still stand.
- Date: 2026-08-21
- Scope: customer smart-wallet recovery and signer rotation

## What changed

A wallet is now created with two keys: a Secure Enclave device key that signs
payments, and a passkey registered as the `RecoverySigner`. The passkey is
replicated by the platform to the owner's other devices, so a lost handset can be
rotated out from a new one. `npm run testnet:recovery` proves the rotation on the
live network, and `docs/passkeys.md` explains why a passkey and not another
enclave key was the only thing that could close this.

Of the four production requirements below, (1) and (3) are met by the contract:
adding a signer runs through `__check_auth`, and `rotate` removes the old signer
and installs the new one in a single call that cannot leave the wallet without
one. **The time delay in (2) and the two independent factors in (4) are not
implemented**, and remain the gate. Until they are, a stolen recovery credential
can rotate a signer to itself in one step and then spend.

## Original decision

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
