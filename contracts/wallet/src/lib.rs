#![no_std]
//! The wallet every account gets. Still the production custody path.
//!
//! Creating an account deploys one of these and funds it, and its only signer is
//! a secp256r1 key minted in the phone's secure element — non-exportable, so
//! there is nothing to phish and nothing to paste into a fake app. The recovery
//! signer and `rotate` are what a customer has instead of a phrase.
//!
//! A classic phrase-derived account is being explored alongside it, so that a
//! customer could bring a wallet they already have. That path is experimental
//! and is not what `CreateAccountScreen` builds; see the `wallet` field in the
//! app store, which says the same thing.

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    symbol_short, BytesN, Env, Symbol, Vec,
};

const BUMP_THRESHOLD: u32 = 34_560;
const BUMP_TO: u32 = 518_400;
const ROTATE_FN: Symbol = symbol_short!("rotate");

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// A device signer that may authorize payments from this wallet.
    Signer(BytesN<65>),
    /// The single recovery signer, which may only rotate a device signer.
    Recovery,
    SignerCount,
}

/// A secp256r1 signature produced by a platform key (Secure Enclave, Android Keystore).
#[contracttype]
#[derive(Clone)]
pub struct WalletSignature {
    pub public_key: BytesN<65>,
    pub signature: BytesN<64>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    UnknownSigner = 1,
    RecoveryScopeExceeded = 2,
    SignerAlreadyRegistered = 3,
    LastSignerCannotBeRemoved = 4,
    RecoveryNotConfigured = 5,
}

#[contract]
pub struct RosaWallet;

#[contractimpl]
impl RosaWallet {
    /// A wallet starts with one device signer and an optional recovery signer.
    pub fn __constructor(env: Env, device_signer: BytesN<65>, recovery_signer: Option<BytesN<65>>) {
        env.storage()
            .persistent()
            .set(&DataKey::Signer(device_signer), &true);
        env.storage().instance().set(&DataKey::SignerCount, &1u32);
        if let Some(recovery) = recovery_signer {
            env.storage().instance().set(&DataKey::Recovery, &recovery);
        }
        bump_instance(&env);
    }

    /// Adding a signer is a wallet decision, so it runs through `__check_auth`.
    pub fn add_signer(env: Env, signer: BytesN<65>) -> Result<(), Error> {
        env.current_contract_address().require_auth();
        let key = DataKey::Signer(signer);
        if env.storage().persistent().has(&key) {
            return Err(Error::SignerAlreadyRegistered);
        }
        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_TO);
        set_signer_count(&env, signer_count(&env) + 1);
        bump_instance(&env);
        Ok(())
    }

    pub fn remove_signer(env: Env, signer: BytesN<65>) -> Result<(), Error> {
        env.current_contract_address().require_auth();
        let key = DataKey::Signer(signer);
        if !env.storage().persistent().has(&key) {
            return Err(Error::UnknownSigner);
        }
        // A wallet with no signer left would be unspendable forever.
        if signer_count(&env) <= 1 {
            return Err(Error::LastSignerCannotBeRemoved);
        }
        env.storage().persistent().remove(&key);
        set_signer_count(&env, signer_count(&env) - 1);
        bump_instance(&env);
        Ok(())
    }

    /// Replaces a lost device signer. The recovery signer may authorize only this.
    pub fn rotate(env: Env, retired: BytesN<65>, replacement: BytesN<65>) -> Result<(), Error> {
        env.current_contract_address().require_auth();
        let retired_key = DataKey::Signer(retired);
        if !env.storage().persistent().has(&retired_key) {
            return Err(Error::UnknownSigner);
        }
        let replacement_key = DataKey::Signer(replacement);
        if env.storage().persistent().has(&replacement_key) {
            return Err(Error::SignerAlreadyRegistered);
        }
        env.storage().persistent().remove(&retired_key);
        env.storage().persistent().set(&replacement_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&replacement_key, BUMP_THRESHOLD, BUMP_TO);
        bump_instance(&env);
        Ok(())
    }

    pub fn is_signer(env: Env, signer: BytesN<65>) -> bool {
        env.storage().persistent().has(&DataKey::Signer(signer))
    }

    pub fn recovery_signer(env: Env) -> Option<BytesN<65>> {
        env.storage().instance().get(&DataKey::Recovery)
    }
}

#[contractimpl]
impl CustomAccountInterface for RosaWallet {
    type Signature = WalletSignature;
    type Error = Error;

    /// Device signers authorize anything the wallet is asked to do; the recovery
    /// signer is deliberately narrower and may only rotate a device signer.
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signature: WalletSignature,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let is_device_signer = env
            .storage()
            .persistent()
            .has(&DataKey::Signer(signature.public_key.clone()));
        let is_recovery_signer = env
            .storage()
            .instance()
            .get::<DataKey, BytesN<65>>(&DataKey::Recovery)
            .map(|recovery| recovery == signature.public_key)
            .unwrap_or(false);

        if !is_device_signer && !is_recovery_signer {
            return Err(Error::UnknownSigner);
        }

        env.crypto().secp256r1_verify(
            &signature.public_key,
            &signature_payload,
            &signature.signature,
        );

        if !is_device_signer {
            assert_recovery_scope(&env, &auth_contexts)?;
        }
        Ok(())
    }
}

fn assert_recovery_scope(env: &Env, auth_contexts: &Vec<Context>) -> Result<(), Error> {
    for context in auth_contexts.iter() {
        match context {
            Context::Contract(contract) => {
                if contract.contract != env.current_contract_address()
                    || contract.fn_name != ROTATE_FN
                {
                    return Err(Error::RecoveryScopeExceeded);
                }
            }
            // Deploying or upgrading is never part of a recovery.
            Context::CreateContractHostFn(_) | Context::CreateContractWithCtorHostFn(_) => {
                return Err(Error::RecoveryScopeExceeded)
            }
        }
    }
    Ok(())
}

fn signer_count(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::SignerCount)
        .unwrap_or(0)
}

fn set_signer_count(env: &Env, count: u32) {
    env.storage().instance().set(&DataKey::SignerCount, &count);
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_TO);
}

mod test;
