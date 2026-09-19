//! Verifying a WebAuthn assertion, so a passkey can authorize this wallet.
//!
//! A passkey does not sign the payload it is given. It signs
//! `authenticatorData || SHA-256(clientDataJSON)`, and the payload appears
//! inside that JSON as a base64url-encoded `challenge`. So verification is two
//! claims, not one: that the signature is genuine, and that the thing it was
//! made over is *this* transaction rather than another one the owner approved
//! earlier.
//!
//! Adapted from OpenZeppelin's audited Stellar verifier, itself adapted from
//! passkey-kit and OpenZeppelin's Solidity `WebAuthn` library:
//!
//! * <https://github.com/OpenZeppelin/stellar-contracts> `packages/accounts/src/verifiers/webauthn.rs`
//! * <https://github.com/kalepail/passkey-kit> `contracts/smart-wallet/src/verify.rs`
//!
//! Four checks the W3C procedure lists are deliberately not made here, matching
//! the OpenZeppelin reasoning: the origin and the RP ID hash are enforced by the
//! platform authenticator before it will sign at all, the signature counter is
//! redundant next to Soroban's own nonce handling, and attestation belongs to
//! registration rather than to authentication.

use soroban_sdk::{contracterror, contracttype, crypto::Hash, Bytes, BytesN, Env, String};

/// Bit 0 of the authenticator data flags: the owner was physically present.
const FLAG_USER_PRESENT: u8 = 0x01;
/// Bit 2: the owner was verified, by biometrics or a device passcode.
const FLAG_USER_VERIFIED: u8 = 0x04;
/// Bit 3: this credential may be backed up by the platform.
const FLAG_BACKUP_ELIGIBLE: u8 = 0x08;
/// Bit 4: this credential is backed up by the platform.
const FLAG_BACKED_UP: u8 = 0x10;

/// A challenge is 43 base64url characters, a type is 12, and an origin is a
/// domain. A kilobyte is far more than any real authenticator emits, and the
/// bound is what lets the JSON be parsed on the stack.
const CLIENT_DATA_MAX_LEN: usize = 1024;
/// 32 bytes of RP ID hash, one of flags, four of counter.
const AUTHENTICATOR_DATA_MIN_LEN: u32 = 37;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum WebAuthnError {
    ClientDataTooLong = 20,
    ClientDataNotJson = 21,
    /// The assertion was made for something other than a sign-in.
    NotAnAuthentication = 22,
    /// The signature is genuine but was made over a different transaction.
    ChallengeMismatch = 23,
    AuthenticatorDataMalformed = 24,
    /// The authenticator did not report the owner being there.
    UserNotPresent = 25,
    /// The authenticator did not report biometrics or a passcode.
    UserNotVerified = 26,
    /// Backed up without being eligible for backup, which cannot happen.
    BackupStateImpossible = 27,
}

/// What the authenticator hands back, carried into `__check_auth`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PasskeyAssertion {
    /// The credential's public key, which is also the signer's identity here.
    pub public_key: BytesN<65>,
    pub signature: BytesN<64>,
    /// RP ID hash, flags and counter, as the authenticator produced them.
    pub authenticator_data: Bytes,
    /// The JSON the client built, carrying the challenge that must match.
    pub client_data: Bytes,
}

/// Only the two fields that decide whether this assertion may be trusted.
#[derive(serde::Deserialize)]
struct ClientData<'a> {
    challenge: &'a str,
    #[serde(rename = "type")]
    ceremony: &'a str,
}

/// Panics unless this assertion authorizes exactly `payload` for `public_key`.
pub fn verify(env: &Env, payload: &Hash<32>, assertion: &PasskeyAssertion) {
    if assertion.client_data.len() > CLIENT_DATA_MAX_LEN as u32 {
        panic_with(env, WebAuthnError::ClientDataTooLong);
    }
    let buffer = assertion.client_data.to_buffer::<CLIENT_DATA_MAX_LEN>();
    let (client_data, _): (ClientData, _) = match serde_json_core::de::from_slice(buffer.as_slice())
    {
        Ok(parsed) => parsed,
        Err(_) => panic_with(env, WebAuthnError::ClientDataNotJson),
    };

    // A registration assertion is signed by the same key and would otherwise be
    // replayable as a sign-in.
    if String::from_str(env, client_data.ceremony) != String::from_str(env, "webauthn.get") {
        panic_with(env, WebAuthnError::NotAnAuthentication);
    }

    // The whole point of the exercise: the signature is genuine, but is it
    // genuine *about this transaction*? A 32-byte payload is 43 base64url
    // characters with no padding.
    let mut expected = [0u8; 43];
    base64_url_encode(&mut expected, &payload.to_array());
    if client_data.challenge.as_bytes() != expected {
        panic_with(env, WebAuthnError::ChallengeMismatch);
    }

    if assertion.authenticator_data.len() < AUTHENTICATOR_DATA_MIN_LEN {
        panic_with(env, WebAuthnError::AuthenticatorDataMalformed);
    }
    // Safe: the length was just checked.
    let flags = assertion.authenticator_data.get(32).unwrap_or(0);

    // Someone has to have been holding the phone.
    if flags & FLAG_USER_PRESENT == 0 {
        panic_with(env, WebAuthnError::UserNotPresent);
    }
    // And they have to have proved they are the owner. This wallet spends money,
    // so a credential that only proves presence is not enough.
    if flags & FLAG_USER_VERIFIED == 0 {
        panic_with(env, WebAuthnError::UserNotVerified);
    }
    // A credential cannot be backed up without being allowed to be.
    if flags & FLAG_BACKUP_ELIGIBLE == 0 && flags & FLAG_BACKED_UP != 0 {
        panic_with(env, WebAuthnError::BackupStateImpossible);
    }

    let mut signed = assertion.authenticator_data.clone();
    signed.extend_from_array(&env.crypto().sha256(&assertion.client_data).to_array());
    env.crypto().secp256r1_verify(
        &assertion.public_key,
        &env.crypto().sha256(&signed),
        &assertion.signature,
    );
}

fn panic_with(env: &Env, error: WebAuthnError) -> ! {
    soroban_sdk::panic_with_error!(env, error)
}

// Ported from Go's `encoding/base64` by way of passkey-kit and OpenZeppelin,
// with padding removed and the alphabet fixed to base64url. The destination is
// pre-sized by the caller, which is what keeps this allocation-free.
//
// Original copyright (c) 2009 The Go Authors. All rights reserved. Used under
// the Go BSD-style licence.
const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

pub fn base64_url_encode(dst: &mut [u8], src: &[u8]) {
    let mut di: usize = 0;
    let mut si: usize = 0;
    let n = (src.len() / 3) * 3;

    while si < n {
        let val = (src[si] as usize) << 16 | (src[si + 1] as usize) << 8 | (src[si + 2] as usize);
        dst[di] = ALPHABET[val >> 18 & 0x3F];
        dst[di + 1] = ALPHABET[val >> 12 & 0x3F];
        dst[di + 2] = ALPHABET[val >> 6 & 0x3F];
        dst[di + 3] = ALPHABET[val & 0x3F];
        si += 3;
        di += 4;
    }

    let remain = src.len() - si;
    if remain == 0 {
        return;
    }

    let mut val = (src[si] as usize) << 16;
    if remain == 2 {
        val |= (src[si + 1] as usize) << 8;
    }

    dst[di] = ALPHABET[val >> 18 & 0x3F];
    dst[di + 1] = ALPHABET[val >> 12 & 0x3F];
    if remain == 2 {
        dst[di + 2] = ALPHABET[val >> 6 & 0x3F];
    }
}
