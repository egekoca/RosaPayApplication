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

pub mod webauthn;
pub use webauthn::{PasskeyAssertion, WebAuthnError};

const BUMP_THRESHOLD: u32 = 34_560;
const BUMP_TO: u32 = 518_400;
const ROTATE_FN: Symbol = symbol_short!("rotate");

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// A signer that may authorize payments from this wallet, and what kind it
    /// is. The kind is stored rather than inferred, because the two are
    /// verified by different rules and a signature must not be checked by the
    /// wrong one.
    Signer(BytesN<65>),
    /// The single recovery signer, which may only rotate another signer.
    Recovery,
    SignerCount,
}

/// The two ways a secp256r1 key can be held on a phone, which are not
/// interchangeable.
///
/// A **device key** is generated inside the Secure Enclave or the Android
/// Keystore. It cannot leave that chip, and the platform never copies it
/// anywhere, so an account with only this kind of signer lives and dies with
/// one handset.
///
/// A **passkey** is a WebAuthn credential. The key is equally unreachable to
/// this app, but the platform - iCloud Keychain, Google Password Manager -
/// replicates it to the owner's other devices. That is what makes an account
/// something a person can still reach after losing a phone, and it is why the
/// two kinds exist side by side rather than one replacing the other.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SignerKind {
    Device,
    Passkey,
}

/// The key that may replace a lost signer, and how that key is held.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecoverySigner {
    pub public_key: BytesN<65>,
    pub kind: SignerKind,
}

/// A secp256r1 signature produced by a platform key (Secure Enclave, Android Keystore).
#[contracttype]
#[derive(Clone)]
pub struct DeviceSignature {
    pub public_key: BytesN<65>,
    pub signature: BytesN<64>,
}

/// What `__check_auth` is handed, which depends on how the key is held.
///
/// A device key signs the authorization payload itself. A passkey signs
/// something it built around the payload, so the assertion has to travel with
/// the signature for the contract to check that the two agree.
#[contracttype]
#[derive(Clone)]
pub enum WalletSignature {
    Device(DeviceSignature),
    Passkey(PasskeyAssertion),
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
    /// A passkey assertion was offered for a key registered as a device key, or
    /// the other way round. The rules differ, so the wrong one is a refusal
    /// rather than something to work out.
    SignerKindMismatch = 6,
}

#[contract]
pub struct RosaWallet;

#[contractimpl]
impl RosaWallet {
    /// A wallet starts with one signer and, if the owner set one up, a recovery
    /// signer that can replace it later.
    pub fn __constructor(
        env: Env,
        signer: BytesN<65>,
        kind: SignerKind,
        recovery_signer: Option<RecoverySigner>,
    ) {
        env.storage().persistent().set(&DataKey::Signer(signer), &kind);
        env.storage().instance().set(&DataKey::SignerCount, &1u32);
        if let Some(recovery) = recovery_signer {
            env.storage().instance().set(&DataKey::Recovery, &recovery);
        }
        bump_instance(&env);
    }

    /// Adding a signer is a wallet decision, so it runs through `__check_auth`.
    ///
    /// This is how a second phone joins an account: it makes its own key, and an
    /// already-trusted device authorizes adding it. The key itself never moves.
    pub fn add_signer(env: Env, signer: BytesN<65>, kind: SignerKind) -> Result<(), Error> {
        env.current_contract_address().require_auth();
        let key = DataKey::Signer(signer);
        if env.storage().persistent().has(&key) {
            return Err(Error::SignerAlreadyRegistered);
        }
        env.storage().persistent().set(&key, &kind);
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

    /// Replaces a lost signer. The recovery signer may authorize only this.
    ///
    /// The count does not move: one signer goes and one arrives, so a rotation
    /// can never be the thing that empties a wallet of signers.
    pub fn rotate(
        env: Env,
        retired: BytesN<65>,
        replacement: BytesN<65>,
        kind: SignerKind,
    ) -> Result<(), Error> {
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
        env.storage().persistent().set(&replacement_key, &kind);
        env.storage()
            .persistent()
            .extend_ttl(&replacement_key, BUMP_THRESHOLD, BUMP_TO);
        bump_instance(&env);
        Ok(())
    }

    /// Names the key that may rotate a lost signer, for a wallet created before
    /// the owner had one. It runs through `__check_auth`, so only the wallet can
    /// decide it, and it refuses to overwrite one that already exists: changing
    /// a recovery key is a rotation, not an edit.
    pub fn set_recovery_signer(env: Env, recovery: RecoverySigner) -> Result<(), Error> {
        env.current_contract_address().require_auth();
        if env
            .storage()
            .instance()
            .get::<DataKey, RecoverySigner>(&DataKey::Recovery)
            .is_some()
        {
            return Err(Error::SignerAlreadyRegistered);
        }
        env.storage().instance().set(&DataKey::Recovery, &recovery);
        bump_instance(&env);
        Ok(())
    }

    pub fn is_signer(env: Env, signer: BytesN<65>) -> bool {
        env.storage().persistent().has(&DataKey::Signer(signer))
    }

    /// How a signer is held, or nothing if this key is not a signer here.
    pub fn signer_kind(env: Env, signer: BytesN<65>) -> Option<SignerKind> {
        env.storage().persistent().get(&DataKey::Signer(signer))
    }

    pub fn signer_count(env: Env) -> u32 {
        signer_count(&env)
    }

    pub fn recovery_signer(env: Env) -> Option<RecoverySigner> {
        env.storage().instance().get(&DataKey::Recovery)
    }
}

#[contractimpl]
impl CustomAccountInterface for RosaWallet {
    type Signature = WalletSignature;
    type Error = Error;

    /// Registered signers authorize anything the wallet is asked to do; the
    /// recovery signer is deliberately narrower and may only rotate another.
    ///
    /// How the signature is checked comes from what the wallet recorded about
    /// that key, never from what the caller offered. A device key signs the
    /// payload; a passkey signs a document that has to be shown to contain the
    /// payload. Letting the caller pick between those rules would be letting
    /// them pick the weaker one.
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signature: WalletSignature,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let (public_key, offered) = match &signature {
            WalletSignature::Device(device) => (device.public_key.clone(), SignerKind::Device),
            WalletSignature::Passkey(assertion) => {
                (assertion.public_key.clone(), SignerKind::Passkey)
            }
        };

        let registered: Option<SignerKind> = env
            .storage()
            .persistent()
            .get(&DataKey::Signer(public_key.clone()));
        let recovery: Option<RecoverySigner> = env.storage().instance().get(&DataKey::Recovery);

        let expected = match (registered, &recovery) {
            (Some(kind), _) => kind,
            (None, Some(recovery)) if recovery.public_key == public_key => recovery.kind,
            _ => return Err(Error::UnknownSigner),
        };
        if expected != offered {
            return Err(Error::SignerKindMismatch);
        }

        match &signature {
            WalletSignature::Device(device) => env.crypto().secp256r1_verify(
                &device.public_key,
                &signature_payload,
                &device.signature,
            ),
            WalletSignature::Passkey(assertion) => {
                webauthn::verify(&env, &signature_payload, assertion)
            }
        }

        // A key that is only the recovery signer, and not a signer in its own
        // right, may do exactly one thing with this wallet.
        if registered.is_none() {
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
