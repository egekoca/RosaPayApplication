#![cfg(test)]
extern crate std;

use super::*;
use p256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey};
use rand_core::OsRng;
use sha2::{Digest, Sha256};
use soroban_sdk::{
    auth::{Context, ContractContext},
    symbol_short,
    testutils::Address as _,
    vec, Address, Bytes, Env, IntoVal,
};
use std::string::String as StdString;
use std::vec::Vec as StdVec;

struct Signer {
    key: SigningKey,
}

impl Signer {
    fn new() -> Self {
        Self {
            key: SigningKey::random(&mut OsRng),
        }
    }

    fn public_key(&self, env: &Env) -> BytesN<65> {
        let encoded = self.key.verifying_key().to_encoded_point(false);
        BytesN::from_array(env, &encoded.as_bytes().try_into().unwrap())
    }

    /// ECDSA produces a high-S signature about half the time; Soroban only
    /// accepts the low-S form, so the test signer normalizes like a wallet must.
    fn sign_digest(&self, env: &Env, digest: &[u8; 32]) -> BytesN<64> {
        let signature: Signature = self.key.sign_prehash(digest).unwrap();
        let normalized = signature.normalize_s().unwrap_or(signature);
        BytesN::from_array(env, &normalized.to_bytes().into())
    }

    /// What a Secure Enclave or Keystore key produces: a signature over the
    /// authorization payload itself.
    fn device(&self, env: &Env, payload: &BytesN<32>) -> WalletSignature {
        WalletSignature::Device(DeviceSignature {
            public_key: self.public_key(env),
            signature: self.sign_digest(env, &payload.to_array()),
        })
    }

    /// What a passkey produces, built the way a real authenticator builds it:
    /// the payload is base64url-encoded into the client data, the client data is
    /// hashed, appended to the authenticator data, and *that* is what is signed.
    fn passkey(&self, env: &Env, payload: &BytesN<32>) -> WalletSignature {
        self.passkey_with(env, &client_data_for(payload), authenticator_data(FLAGS_OK))
    }

    fn passkey_with(
        &self,
        env: &Env,
        client_data: &str,
        authenticator_data: StdVec<u8>,
    ) -> WalletSignature {
        let client_data_hash = Sha256::digest(client_data.as_bytes());
        let mut signed = authenticator_data.clone();
        signed.extend_from_slice(&client_data_hash);
        let digest: [u8; 32] = Sha256::digest(&signed).into();

        WalletSignature::Passkey(PasskeyAssertion {
            public_key: self.public_key(env),
            signature: self.sign_digest(env, &digest),
            authenticator_data: Bytes::from_slice(env, &authenticator_data),
            client_data: Bytes::from_slice(env, client_data.as_bytes()),
        })
    }
}

/// User present, user verified, backup eligible and backed up: what a synced
/// platform passkey reports after a Face ID prompt.
const FLAGS_OK: u8 = 0x01 | 0x04 | 0x08 | 0x10;

fn authenticator_data(flags: u8) -> StdVec<u8> {
    let mut data = StdVec::new();
    data.extend_from_slice(&[0x49; 32]); // RP ID hash, not checked on-chain
    data.push(flags);
    data.extend_from_slice(&[0, 0, 0, 1]); // signature counter
    data
}

fn base64_url(bytes: &[u8]) -> StdString {
    let mut out = std::vec![0u8; bytes.len().div_ceil(3) * 4 - (3 - bytes.len() % 3) % 3];
    webauthn::base64_url_encode(&mut out, bytes);
    StdString::from_utf8(out).unwrap()
}

fn client_data_for(payload: &BytesN<32>) -> StdString {
    client_data("webauthn.get", &base64_url(&payload.to_array()))
}

fn client_data(ceremony: &str, challenge: &str) -> StdString {
    std::format!(
        r#"{{"type":"{}","challenge":"{}","origin":"https://rosapay-mobile.vercel.app","crossOrigin":false}}"#,
        ceremony,
        challenge
    )
}

fn deploy(env: &Env, signer: &Signer, kind: SignerKind, recovery: Option<RecoverySigner>) -> Address {
    env.register(RosaWallet, (signer.public_key(env), kind, recovery))
}

fn recovery_of(env: &Env, signer: &Signer, kind: SignerKind) -> RecoverySigner {
    RecoverySigner {
        public_key: signer.public_key(env),
        kind,
    }
}

fn payload(env: &Env, byte: u8) -> BytesN<32> {
    BytesN::from_array(env, &[byte; 32])
}

fn payment_context(env: &Env, wallet: &Address) -> Vec<Context> {
    vec![
        env,
        Context::Contract(ContractContext {
            contract: Address::generate(env),
            fn_name: symbol_short!("settle"),
            args: vec![env, wallet.into_val(env)],
        }),
    ]
}

fn rotate_context(env: &Env, wallet: &Address) -> Vec<Context> {
    vec![
        env,
        Context::Contract(ContractContext {
            contract: wallet.clone(),
            fn_name: symbol_short!("rotate"),
            args: vec![env],
        }),
    ]
}

/// A wallet refuses in two different ways and the tests care which.
///
/// A rule the contract states itself - an unknown signer, the wrong kind of
/// signature - comes back as a typed error. A failed cryptographic check does
/// not: `secp256r1_verify` and the WebAuthn validations panic, which unwinds
/// the whole invocation. `None` is that second kind, and it is still a refusal.
fn check(
    env: &Env,
    wallet: &Address,
    payload: &BytesN<32>,
    signature: WalletSignature,
    contexts: &Vec<Context>,
) -> Result<(), Option<Error>> {
    env.try_invoke_contract_check_auth::<Error>(wallet, payload, signature.into_val(env), contexts)
        .map_err(|error| error.ok())
}

// ---------------------------------------------------------------------------
// Device keys
// ---------------------------------------------------------------------------

#[test]
fn device_signer_authorizes_a_payment() {
    let env = Env::default();
    let device = Signer::new();
    let wallet = deploy(&env, &device, SignerKind::Device, None);
    let message = payload(&env, 7);

    check(
        &env,
        &wallet,
        &message,
        device.device(&env, &message),
        &payment_context(&env, &wallet),
    )
    .unwrap();
}

#[test]
fn rejects_an_unknown_signer_and_a_wrong_signature() {
    let env = Env::default();
    let device = Signer::new();
    let stranger = Signer::new();
    let wallet = deploy(&env, &device, SignerKind::Device, None);
    let message = payload(&env, 9);

    assert_eq!(
        check(
            &env,
            &wallet,
            &message,
            stranger.device(&env, &message),
            &payment_context(&env, &wallet),
        ),
        Err(Some(Error::UnknownSigner))
    );

    // A registered signer cannot reuse a signature over another payload.
    let other = payload(&env, 10);
    assert!(check(
        &env,
        &wallet,
        &message,
        device.device(&env, &other),
        &payment_context(&env, &wallet),
    )
    .is_err());
}

// ---------------------------------------------------------------------------
// Passkeys
// ---------------------------------------------------------------------------

#[test]
fn a_passkey_authorizes_a_payment() {
    let env = Env::default();
    let passkey = Signer::new();
    let wallet = deploy(&env, &passkey, SignerKind::Passkey, None);
    let message = payload(&env, 21);

    check(
        &env,
        &wallet,
        &message,
        passkey.passkey(&env, &message),
        &payment_context(&env, &wallet),
    )
    .unwrap();
}

#[test]
fn a_passkey_assertion_is_bound_to_the_payload_it_was_made_for() {
    let env = Env::default();
    let passkey = Signer::new();
    let wallet = deploy(&env, &passkey, SignerKind::Passkey, None);

    // An assertion the owner really did make, for a different transaction. The
    // signature is genuine; the challenge inside it is not this one.
    let approved = passkey.passkey(&env, &payload(&env, 22));
    assert!(check(
        &env,
        &wallet,
        &payload(&env, 23),
        approved,
        &payment_context(&env, &wallet),
    )
    .is_err());
}

#[test]
fn a_registration_assertion_cannot_be_used_to_spend() {
    let env = Env::default();
    let passkey = Signer::new();
    let wallet = deploy(&env, &passkey, SignerKind::Passkey, None);
    let message = payload(&env, 24);

    // Same key, same challenge, but the ceremony was `webauthn.create`.
    let registration = passkey.passkey_with(
        &env,
        &client_data("webauthn.create", &base64_url(&message.to_array())),
        authenticator_data(FLAGS_OK),
    );
    assert!(check(
        &env,
        &wallet,
        &message,
        registration,
        &payment_context(&env, &wallet),
    )
    .is_err());
}

#[test]
fn a_passkey_that_did_not_verify_the_owner_cannot_spend() {
    let env = Env::default();
    let passkey = Signer::new();
    let wallet = deploy(&env, &passkey, SignerKind::Passkey, None);
    let message = payload(&env, 25);

    // Present but not verified: someone tapped the key without proving they are
    // the owner. This wallet spends money, so that is not enough.
    let unverified = passkey.passkey_with(
        &env,
        &client_data_for(&message),
        authenticator_data(0x01 | 0x08),
    );
    assert!(check(
        &env,
        &wallet,
        &message,
        unverified,
        &payment_context(&env, &wallet),
    )
    .is_err());

    // Nobody was there at all.
    let absent = passkey.passkey_with(
        &env,
        &client_data_for(&message),
        authenticator_data(0x04 | 0x08),
    );
    assert!(check(
        &env,
        &wallet,
        &message,
        absent,
        &payment_context(&env, &wallet),
    )
    .is_err());
}

#[test]
fn malformed_authenticator_data_is_refused() {
    let env = Env::default();
    let passkey = Signer::new();
    let wallet = deploy(&env, &passkey, SignerKind::Passkey, None);
    let message = payload(&env, 26);

    let truncated =
        passkey.passkey_with(&env, &client_data_for(&message), std::vec![0x49; 20]);
    assert!(check(
        &env,
        &wallet,
        &message,
        truncated,
        &payment_context(&env, &wallet),
    )
    .is_err());
}

#[test]
fn client_data_that_is_not_json_is_refused() {
    let env = Env::default();
    let passkey = Signer::new();
    let wallet = deploy(&env, &passkey, SignerKind::Passkey, None);
    let message = payload(&env, 27);

    let garbage = passkey.passkey_with(&env, "not json at all", authenticator_data(FLAGS_OK));
    assert!(check(
        &env,
        &wallet,
        &message,
        garbage,
        &payment_context(&env, &wallet),
    )
    .is_err());
}

#[test]
fn the_wallet_checks_a_key_by_the_rules_it_was_registered_under() {
    let env = Env::default();
    let key = Signer::new();
    let message = payload(&env, 28);

    // Registered as a passkey, offered as a device key.
    let passkey_wallet = deploy(&env, &key, SignerKind::Passkey, None);
    assert_eq!(
        check(
            &env,
            &passkey_wallet,
            &message,
            key.device(&env, &message),
            &payment_context(&env, &passkey_wallet),
        ),
        Err(Some(Error::SignerKindMismatch))
    );

    // And the other way round, which is the direction that would matter: a
    // caller must not be able to skip the WebAuthn checks by claiming the key
    // is something simpler.
    let device_wallet = deploy(&env, &key, SignerKind::Device, None);
    assert_eq!(
        check(
            &env,
            &device_wallet,
            &message,
            key.passkey(&env, &message),
            &payment_context(&env, &device_wallet),
        ),
        Err(Some(Error::SignerKindMismatch))
    );
}

// ---------------------------------------------------------------------------
// Recovery and multiple devices
// ---------------------------------------------------------------------------

#[test]
fn recovery_signer_may_only_rotate() {
    let env = Env::default();
    let device = Signer::new();
    let recovery = Signer::new();
    let wallet = deploy(
        &env,
        &device,
        SignerKind::Device,
        Some(recovery_of(&env, &recovery, SignerKind::Device)),
    );
    let message = payload(&env, 11);

    check(
        &env,
        &wallet,
        &message,
        recovery.device(&env, &message),
        &rotate_context(&env, &wallet),
    )
    .unwrap();

    assert_eq!(
        check(
            &env,
            &wallet,
            &message,
            recovery.device(&env, &message),
            &payment_context(&env, &wallet),
        ),
        Err(Some(Error::RecoveryScopeExceeded))
    );
}

#[test]
fn a_passkey_can_be_the_recovery_signer() {
    let env = Env::default();
    let device = Signer::new();
    let recovery = Signer::new();
    let wallet = deploy(
        &env,
        &device,
        SignerKind::Device,
        Some(recovery_of(&env, &recovery, SignerKind::Passkey)),
    );
    let message = payload(&env, 12);

    check(
        &env,
        &wallet,
        &message,
        recovery.passkey(&env, &message),
        &rotate_context(&env, &wallet),
    )
    .unwrap();
}

#[test]
fn a_wallet_can_be_given_a_recovery_signer_it_was_created_without() {
    let env = Env::default();
    env.mock_all_auths();
    let device = Signer::new();
    let recovery = Signer::new();
    let wallet = deploy(&env, &device, SignerKind::Device, None);
    let client = RosaWalletClient::new(&env, &wallet);

    assert_eq!(client.recovery_signer(), None);
    let named = recovery_of(&env, &recovery, SignerKind::Passkey);
    client.set_recovery_signer(&named);
    assert_eq!(client.recovery_signer(), Some(named.clone()));

    // Replacing it is a rotation, not an edit, so it is refused here.
    let other = recovery_of(&env, &Signer::new(), SignerKind::Passkey);
    assert_eq!(
        client.try_set_recovery_signer(&other),
        Err(Ok(Error::SignerAlreadyRegistered))
    );
}

#[test]
fn rotates_a_lost_device_signer_to_a_passkey() {
    let env = Env::default();
    env.mock_all_auths();
    let device = Signer::new();
    let replacement = Signer::new();
    let wallet = deploy(&env, &device, SignerKind::Device, None);
    let client = RosaWalletClient::new(&env, &wallet);

    client.rotate(
        &device.public_key(&env),
        &replacement.public_key(&env),
        &SignerKind::Passkey,
    );

    assert!(!client.is_signer(&device.public_key(&env)));
    assert_eq!(
        client.signer_kind(&replacement.public_key(&env)),
        Some(SignerKind::Passkey)
    );
    // A rotation swaps one signer for another and must never leave the wallet
    // with none.
    assert_eq!(client.signer_count(), 1);
}

#[test]
fn a_second_phone_joins_with_its_own_key() {
    let env = Env::default();
    env.mock_all_auths();
    let first = Signer::new();
    let second = Signer::new();
    let wallet = deploy(&env, &first, SignerKind::Passkey, None);
    let client = RosaWalletClient::new(&env, &wallet);

    client.add_signer(&second.public_key(&env), &SignerKind::Device);
    assert_eq!(client.signer_count(), 2);

    // Either phone can now authorize on its own, each checked by its own rules.
    let message = payload(&env, 31);
    check(
        &env,
        &wallet,
        &message,
        first.passkey(&env, &message),
        &payment_context(&env, &wallet),
    )
    .unwrap();
    check(
        &env,
        &wallet,
        &message,
        second.device(&env, &message),
        &payment_context(&env, &wallet),
    )
    .unwrap();
}

#[test]
fn keeps_the_wallet_spendable() {
    let env = Env::default();
    env.mock_all_auths();
    let device = Signer::new();
    let second = Signer::new();
    let wallet = deploy(&env, &device, SignerKind::Device, None);
    let client = RosaWalletClient::new(&env, &wallet);

    assert_eq!(
        client.try_remove_signer(&device.public_key(&env)),
        Err(Ok(Error::LastSignerCannotBeRemoved))
    );

    client.add_signer(&second.public_key(&env), &SignerKind::Passkey);
    assert_eq!(
        client.try_add_signer(&second.public_key(&env), &SignerKind::Passkey),
        Err(Ok(Error::SignerAlreadyRegistered))
    );
    client.remove_signer(&device.public_key(&env));
    assert!(client.is_signer(&second.public_key(&env)));
}

#[test]
fn signer_changes_require_the_wallet_to_authorize() {
    let env = Env::default();
    let device = Signer::new();
    let second = Signer::new();
    let wallet = deploy(&env, &device, SignerKind::Device, None);
    let client = RosaWalletClient::new(&env, &wallet);

    // No authorization is mocked here, so the wallet must refuse the change.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.try_add_signer(&second.public_key(&env), &SignerKind::Device)
    }));
    assert!(result.is_err() || result.unwrap().is_err());
    assert!(!client.is_signer(&second.public_key(&env)));
}
