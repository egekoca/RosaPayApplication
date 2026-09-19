#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype,
    token::TokenClient, xdr::ToXdr, Address, Bytes, BytesN, Env,
};

const DAY_IN_LEDGERS: u32 = 17_280;
const BUMP_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const BUMP_TO: u32 = 120 * DAY_IN_LEDGERS;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    Merchant(BytesN<32>),
    SupportedAsset(Address),
    ConsumedIntent(BytesN<32>),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Merchant {
    pub signing_key: BytesN<32>,
    pub recipient: Address,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentIntent {
    pub network_id: BytesN<32>,
    pub settlement_contract: Address,
    pub intent_id: BytesN<32>,
    pub nonce: BytesN<32>,
    pub merchant_id: BytesN<32>,
    pub customer: Address,
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
    pub expires_at_ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    MerchantNotFound = 1,
    MerchantRevoked = 2,
    RecipientMismatch = 3,
    UnsupportedAsset = 4,
    InvalidAmount = 5,
    IntentExpired = 6,
    IntentConsumed = 7,
    WrongNetwork = 8,
    WrongContract = 9,
}

#[contractevent]
pub struct MerchantRegistered {
    #[topic]
    pub merchant_id: BytesN<32>,
    #[topic]
    pub recipient: Address,
}

#[contractevent]
pub struct PaymentSettled {
    #[topic]
    pub intent_id: BytesN<32>,
    #[topic]
    pub merchant_id: BytesN<32>,
    pub customer: Address,
    pub recipient: Address,
    pub token: Address,
    pub amount: i128,
}

#[contract]
pub struct SettlementContract;

#[contractimpl]
impl SettlementContract {
    pub fn __constructor(env: Env, admin: Address, initial_asset: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .persistent()
            .set(&DataKey::SupportedAsset(initial_asset), &true);
    }

    pub fn register_asset(env: Env, asset: Address, supported: bool) {
        require_admin(&env);
        let key = DataKey::SupportedAsset(asset);
        env.storage().persistent().set(&key, &supported);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_TO);
        bump_instance_ttl(&env);
    }

    pub fn register_merchant(
        env: Env,
        merchant_id: BytesN<32>,
        signing_key: BytesN<32>,
        recipient: Address,
    ) {
        require_admin(&env);
        let key = DataKey::Merchant(merchant_id.clone());
        env.storage().persistent().set(
            &key,
            &Merchant {
                signing_key,
                recipient: recipient.clone(),
                active: true,
            },
        );
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_TO);
        bump_instance_ttl(&env);
        MerchantRegistered {
            merchant_id,
            recipient,
        }
        .publish(&env);
    }

    pub fn revoke_merchant(env: Env, merchant_id: BytesN<32>) -> Result<(), Error> {
        require_admin(&env);
        let key = DataKey::Merchant(merchant_id);
        let mut merchant: Merchant = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::MerchantNotFound)?;
        merchant.active = false;
        env.storage().persistent().set(&key, &merchant);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, BUMP_TO);
        bump_instance_ttl(&env);
        Ok(())
    }

    pub fn intent_digest(env: Env, intent: PaymentIntent) -> BytesN<32> {
        env.crypto().sha256(&intent.to_xdr(&env)).into()
    }

    pub fn settle_payment(
        env: Env,
        intent: PaymentIntent,
        merchant_signature: BytesN<64>,
    ) -> Result<(), Error> {
        validate_context(&env, &intent)?;
        let merchant_key = DataKey::Merchant(intent.merchant_id.clone());
        let merchant: Merchant = env
            .storage()
            .persistent()
            .get(&merchant_key)
            .ok_or(Error::MerchantNotFound)?;
        if !merchant.active {
            return Err(Error::MerchantRevoked);
        }
        if merchant.recipient != intent.recipient {
            return Err(Error::RecipientMismatch);
        }
        let asset_key = DataKey::SupportedAsset(intent.token.clone());
        if !env
            .storage()
            .persistent()
            .get::<_, bool>(&asset_key)
            .unwrap_or(false)
        {
            return Err(Error::UnsupportedAsset);
        }

        let consumed_key = DataKey::ConsumedIntent(intent.intent_id.clone());
        if env.storage().persistent().has(&consumed_key) {
            return Err(Error::IntentConsumed);
        }

        intent.customer.require_auth();
        let digest = Self::intent_digest(env.clone(), intent.clone());
        let message: Bytes = digest.clone().into();
        env.crypto().ed25519_verify(
            &merchant.signing_key,
            &message,
            &merchant_signature,
        );

        env.storage().persistent().set(&consumed_key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&consumed_key, BUMP_THRESHOLD, BUMP_TO);
        TokenClient::new(&env, &intent.token).transfer(
            &intent.customer,
            &intent.recipient,
            &intent.amount,
        );

        env.storage()
            .persistent()
            .extend_ttl(&merchant_key, BUMP_THRESHOLD, BUMP_TO);
        env.storage()
            .persistent()
            .extend_ttl(&asset_key, BUMP_THRESHOLD, BUMP_TO);
        bump_instance_ttl(&env);
        PaymentSettled {
            intent_id: intent.intent_id,
            merchant_id: intent.merchant_id,
            customer: intent.customer,
            recipient: intent.recipient,
            token: intent.token,
            amount: intent.amount,
        }
        .publish(&env);
        Ok(())
    }

    pub fn is_intent_consumed(env: Env, intent_id: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::ConsumedIntent(intent_id))
    }

    pub fn get_merchant(env: Env, merchant_id: BytesN<32>) -> Option<Merchant> {
        env.storage()
            .persistent()
            .get(&DataKey::Merchant(merchant_id))
    }
}

fn require_admin(env: &Env) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
}

fn validate_context(env: &Env, intent: &PaymentIntent) -> Result<(), Error> {
    if intent.amount <= 0 {
        return Err(Error::InvalidAmount);
    }
    if intent.expires_at_ledger <= env.ledger().sequence() {
        return Err(Error::IntentExpired);
    }
    if intent.network_id != env.ledger().network_id() {
        return Err(Error::WrongNetwork);
    }
    if intent.settlement_contract != env.current_contract_address() {
        return Err(Error::WrongContract);
    }
    Ok(())
}

fn bump_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(BUMP_THRESHOLD, BUMP_TO);
}

#[cfg(test)]
mod test;
