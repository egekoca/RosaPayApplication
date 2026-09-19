#![cfg(test)]
extern crate std;

use super::*;
use p256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey};
use rand_core::OsRng;
use soroban_sdk::{
    auth::{Context, ContractContext},
    symbol_short,
    testutils::Address as _,
    vec, Address, Env, IntoVal,
};

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
    fn sign(&self, env: &Env, payload: &BytesN<32>) -> BytesN<64> {
        let signature: Signature = self.key.sign_prehash(&payload.to_array()).unwrap();
        let normalized = signature.normalize_s().unwrap_or(signature);
        BytesN::from_array(env, &normalized.to_bytes().into())
    }
}

fn deploy(env: &Env, device: &Signer, recovery: Option<&Signer>) -> Address {
    env.register(
        RosaWallet,
        (
            device.public_key(env),
            recovery.map(|signer| signer.public_key(env)),
        ),
    )
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

#[test]
fn device_signer_authorizes_a_payment() {
    let env = Env::default();
    let device = Signer::new();
    let wallet = deploy(&env, &device, None);
    let message = payload(&env, 7);

    let signature = WalletSignature {
        public_key: device.public_key(&env),
        signature: device.sign(&env, &message),
    };

    env.try_invoke_contract_check_auth::<Error>(
        &wallet,
        &message,
        signature.into_val(&env),
        &payment_context(&env, &wallet),
    )
    .unwrap();
}

#[test]
fn rejects_an_unknown_signer_and_a_wrong_signature() {
    let env = Env::default();
    let device = Signer::new();
    let stranger = Signer::new();
    let wallet = deploy(&env, &device, None);
    let message = payload(&env, 9);

    let unknown = WalletSignature {
        public_key: stranger.public_key(&env),
        signature: stranger.sign(&env, &message),
    };
    let error = env
        .try_invoke_contract_check_auth::<Error>(
            &wallet,
            &message,
            unknown.into_val(&env),
            &payment_context(&env, &wallet),
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(error, Error::UnknownSigner);

    // A registered signer cannot reuse a signature over another payload.
    let mismatched = WalletSignature {
        public_key: device.public_key(&env),
        signature: device.sign(&env, &payload(&env, 10)),
    };
    assert!(env
        .try_invoke_contract_check_auth::<Error>(
            &wallet,
            &message,
            mismatched.into_val(&env),
            &payment_context(&env, &wallet),
        )
        .is_err());
}

#[test]
fn recovery_signer_may_only_rotate() {
    let env = Env::default();
    let device = Signer::new();
    let recovery = Signer::new();
    let wallet = deploy(&env, &device, Some(&recovery));
    let message = payload(&env, 11);

    let signature = WalletSignature {
        public_key: recovery.public_key(&env),
        signature: recovery.sign(&env, &message),
    };

    env.try_invoke_contract_check_auth::<Error>(
        &wallet,
        &message,
        signature.clone().into_val(&env),
        &rotate_context(&env, &wallet),
    )
    .unwrap();

    let error = env
        .try_invoke_contract_check_auth::<Error>(
            &wallet,
            &message,
            signature.into_val(&env),
            &payment_context(&env, &wallet),
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(error, Error::RecoveryScopeExceeded);
}

#[test]
fn rotates_a_lost_device_signer() {
    let env = Env::default();
    env.mock_all_auths();
    let device = Signer::new();
    let replacement = Signer::new();
    let wallet = deploy(&env, &device, None);
    let client = RosaWalletClient::new(&env, &wallet);

    client.rotate(&device.public_key(&env), &replacement.public_key(&env));

    assert!(!client.is_signer(&device.public_key(&env)));
    assert!(client.is_signer(&replacement.public_key(&env)));
}

#[test]
fn keeps_the_wallet_spendable() {
    let env = Env::default();
    env.mock_all_auths();
    let device = Signer::new();
    let second = Signer::new();
    let wallet = deploy(&env, &device, None);
    let client = RosaWalletClient::new(&env, &wallet);

    assert_eq!(
        client.try_remove_signer(&device.public_key(&env)),
        Err(Ok(Error::LastSignerCannotBeRemoved))
    );

    client.add_signer(&second.public_key(&env));
    assert_eq!(
        client.try_add_signer(&second.public_key(&env)),
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
    let wallet = deploy(&env, &device, None);
    let client = RosaWalletClient::new(&env, &wallet);

    // No authorization is mocked here, so the wallet must refuse the change.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.try_add_signer(&second.public_key(&env))
    }));
    assert!(result.is_err() || result.unwrap().is_err());
    assert!(!client.is_signer(&second.public_key(&env)));
}
