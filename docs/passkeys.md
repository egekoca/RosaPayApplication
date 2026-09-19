# Passkeys, and why a wallet needs one

## The problem this solves

A Stellar classic account signs with ed25519. No iPhone Secure Enclave will hold
an ed25519 key — it generates P-256 and nothing else — so a classic account's
secret has to exist as bytes in software. This app stores it as well as it can
be stored, in the Keychain behind biometrics, never logged. It is still a secret
that exists, and the customer still has twelve words, which is a thing that can
be photographed, typed into the wrong website, or read aloud over the phone.

A Soroban contract account can verify P-256 in `__check_auth`. That is the only
route to a key on Stellar that literally cannot leave the chip, and it is why
`contracts/wallet` exists.

But a Secure Enclave key is bound to one handset, permanently and by design. An
account whose only signer is that key is an account that dies with the phone.
That was the state of this wallet until now, and [ADR 0002](adr/0002-recovery-and-signer-rotation.md)
said so plainly.

A passkey is the same P-256 cryptography with the one difference that closes it:
iCloud Keychain and Google Password Manager replicate the credential to the
owner's other devices. The key is still unreachable to this app. It is simply
also on their other phone.

## The two kinds, side by side

The contract records how each signer is held and checks it by those rules and no
others. Letting a caller choose which rules apply would be letting them choose
the weaker ones, so `SignerKindMismatch` is a refusal rather than something to
work out.

| | device key | passkey |
|---|---|---|
| Where it is made | Secure Enclave / Android Keystore | platform authenticator |
| Reachable by this app | no | no |
| Replicated to other devices | **no** | **yes** |
| What it signs | the authorization payload | `authenticatorData ‖ SHA-256(clientDataJSON)` |
| Contract variant | `WalletSignature::Device` | `WalletSignature::Passkey` |

A passkey never signs the payload it is handed. It builds a client-data document
around it and signs that, so verification is two claims rather than one: the
signature is genuine, **and** the thing it was made over is this transaction. The
second is the one that matters, and it is what
`contracts/wallet/src/webauthn.rs` spends its length on. That verifier is adapted
from OpenZeppelin's audited Stellar implementation, itself adapted from
passkey-kit; the attributions are in the file.

Four checks from the W3C procedure are deliberately not made on-chain, matching
OpenZeppelin's reasoning: origin and RP ID hash are enforced by the platform
before it will sign at all, the signature counter is redundant next to Soroban's
nonce handling, and attestation belongs to registration rather than
authentication.

## How the wallet is set up now

Provisioning creates **two** keys, not one:

- the **device key**, which signs payments — the enclave prompt is lighter than
  the system passkey sheet, and this path was already proven;
- the **passkey**, registered as the wallet's `RecoverySigner`.

The contract restricts a key that is *only* the recovery signer to `rotate` and
nothing else. So the passkey can rescue the wallet and cannot spend from it.

A phone that cannot make a passkey still gets a wallet. Refusing would be the
wrong trade — an account that works and cannot be recovered beats no account —
and the app records the absence rather than implying a safety net that is not
there. A dismissed prompt is treated the same way.

## Losing a phone

The replacement phone arrives knowing nothing: not the contract address, not the
device key it has to rotate out. Both are already public on the ledger, so
`POST /v1/wallets/recover` only saves it from scanning; holding the credential is
not what authorizes anything. The contract is what authorizes: only the
registered recovery signer may call `rotate`, and only `rotate`.

```text
1  new phone makes its own Secure Enclave key
2  the synced passkey answers an assertion, giving its credential id
3  the API returns { walletContractId, retiredSigner }
4  rotate(retiredSigner, newDeviceKey, Device), signed by the passkey
5  the new phone controls the wallet; the lost key is out
```

`npm run testnet:recovery` acts this out against the live network and asserts all
five steps, including the two that matter most: the lost key can no longer
authorize, and the passkey still cannot do anything but rotate.

In the app it is a screen, not a script. **I lost my phone** on the welcome
screen leads to it, worded for someone who has nothing to type — because they
genuinely do not, and a recovery nobody can find is not one. The screen asks for
the passkey twice on purpose: once to find the wallet, once to authorize moving
it. Merging them would be asking for authority before saying what it is for.

## What still has to be filled in

**Passkeys are scoped to a domain, not to an app.** Both platforms refuse before
the customer sees anything unless the domain vouches for the app, and both
placeholder values below are things only the project owner can supply.

**iOS** — `apps/web/.well-known/apple-app-site-association`:

```json
{"webcredentials": {"apps": ["REPLACE_WITH_TEAM_ID.com.rosapay"]}}
```

The Team ID is in the Apple Developer account, or in Xcode under Signing &
Capabilities once a team is selected. The app's Associated Domains entitlement
already names `webcredentials:rosa-pay-app.vercel.app`.

**Android** — `apps/web/.well-known/assetlinks.json`:

```json
"sha256_cert_fingerprints": ["REPLACE_WITH_SIGNING_CERT_SHA256"]
```

For a debug build:

```bash
keytool -list -v -keystore ~/.android/debug.keystore \
  -alias androiddebugkey -storepass android -keypass android | grep SHA256
```

Both files must be served from the domain root as `application/json`;
`apps/web/vercel.json` already sets that.

## What is proven, and what is not

Proven on Testnet, without a phone:

- `npm run testnet:passkey` — a real WebAuthn assertion authorizes the wallet,
  and four refusals hold: an assertion made for another payload, a registration
  ceremony replayed as a sign-in, an assertion where the owner was not verified,
  and a device signature offered for a passkey.
- `npm run testnet:recovery` — the rotation flow above, end to end.
- `packages/secure-signer` — the attestation parser, checked against a real
  Apple attestation object, cross-referenced against the public key inside that
  blob's own X.509 certificate.
- `npm run testnet:bridge` — a smart wallet using the lira ramp both ways, which
  is what the passkey wallet needed before it could be anyone's only wallet.

Not proven, and not provable here: the platform half. A simulator has no real
passkey, and iOS additionally needs a real device, a signing team and a live
`apple-app-site-association`. The native modules compile — `xcodebuild` and
`compileDebugKotlin` both pass — but "a customer tapped Face ID and the payment
settled" needs a handset and the two values above.
