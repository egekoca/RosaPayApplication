#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype,
    token::TokenClient, xdr::ToXdr, Address, Bytes, BytesN, Env, Vec,
};

/// The slice of Soroswap's router this contract needs.
///
/// `swap_tokens_for_exact_tokens` is the only shape that fits a payment: the
/// merchant named an exact amount, so the output is fixed and the input is
/// whatever the pool charges, bounded by `amount_in_max`. The mirror function,
/// `swap_exact_tokens_for_tokens`, would leave the merchant holding whatever
/// the market happened to give, which is not what they signed for.
///
/// The router's own signature returns `Result<Vec<i128>, CombinedRouterError>`.
/// Declaring it as the bare `Vec<i128>` means a router-side failure - no pool,
/// deadline passed, input above the ceiling - trips this call instead of being
/// swallowed, and the whole payment rolls back with the swap.
#[contractclient(name = "SwapRouterClient")]
pub trait SwapRouter {
    fn swap_tokens_for_exact_tokens(
        env: Env,
        amount_out: i128,
        amount_in_max: i128,
        path: Vec<Address>,
        to: Address,
        deadline: u64,
    ) -> Vec<i128>;
}

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
    /// The one AMM router this contract will route a funding swap through.
    /// Held in storage rather than passed in, so a relayer that submits the
    /// transaction cannot point the swap at a contract of its own.
    SwapRouter,
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
    SwapRouterNotSet = 10,
    /// The path must end at the token the merchant asked for and start
    /// somewhere else, with at least those two hops in it.
    InvalidSwapPath = 11,
    /// A swap with no ceiling on what it may spend is not a payment, it is a
    /// blank cheque.
    InvalidSwapLimit = 12,
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

/// Emitted next to `PaymentSettled` when the customer did not hold the token
/// the merchant asked for and the shortfall was bought on the way through.
#[contractevent]
pub struct PaymentFunded {
    #[topic]
    pub intent_id: BytesN<32>,
    #[topic]
    pub source_token: Address,
    pub customer: Address,
    /// What the pool actually charged, which is never more than the ceiling the
    /// customer signed for.
    pub amount_in: i128,
    pub amount_out: i128,
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

    /// Names the AMM this contract may route a funding swap through. Until it
    /// is set, `settle_payment_with_swap` refuses rather than falling back to
    /// an address someone handed it.
    pub fn set_swap_router(env: Env, router: Address) {
        require_admin(&env);
        env.storage().instance().set(&DataKey::SwapRouter, &router);
        bump_instance_ttl(&env);
    }

    pub fn swap_router(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::SwapRouter)
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

    /// The original path: the customer already holds the token the merchant
    /// asked for, and it moves straight across.
    pub fn settle_payment(
        env: Env,
        intent: PaymentIntent,
        merchant_signature: BytesN<64>,
    ) -> Result<(), Error> {
        authorize_intent(&env, &intent, &merchant_signature)?;
        TokenClient::new(&env, &intent.token).transfer(
            &intent.customer,
            &intent.recipient,
            &intent.amount,
        );
        publish_settled(&env, intent);
        Ok(())
    }

    /// The same payment, funded from a token the customer does hold.
    ///
    /// A merchant priced a coffee in USDC; the customer has only XLM. Without
    /// this the payment simply cannot happen, because the transfer above moves
    /// one named token and the customer's balance of it is zero.
    ///
    /// What matters is what is *not* in this signature. `path`, `amount_in_max`
    /// and `deadline` are the customer's own funding choice and are not part of
    /// the merchant's signed intent, so no arrangement of them can change who
    /// is paid, in what, or how much: the router is told an exact `amount_out`,
    /// and the transfer that follows is the same one `settle_payment` makes.
    /// A merchant signature made before Soroswap existed still settles here and
    /// still means exactly what it meant.
    ///
    /// The swap and the transfer share one transaction, so a payment that fails
    /// after the swap leaves the customer holding their original token rather
    /// than a balance they did not ask for.
    pub fn settle_payment_with_swap(
        env: Env,
        intent: PaymentIntent,
        merchant_signature: BytesN<64>,
        path: Vec<Address>,
        amount_in_max: i128,
        deadline: u64,
    ) -> Result<(), Error> {
        let router: Address = env
            .storage()
            .instance()
            .get(&DataKey::SwapRouter)
            .ok_or(Error::SwapRouterNotSet)?;
        if amount_in_max <= 0 {
            return Err(Error::InvalidSwapLimit);
        }
        // Two hops minimum, ending where the merchant asked and starting
        // anywhere else. A path that ends elsewhere would buy the wrong token;
        // one that starts there is not a swap and would only burn the fee.
        let source_token = path.first().ok_or(Error::InvalidSwapPath)?;
        let bought = path.last().ok_or(Error::InvalidSwapPath)?;
        if path.len() < 2 || bought != intent.token || source_token == intent.token {
            return Err(Error::InvalidSwapPath);
        }

        authorize_intent(&env, &intent, &merchant_signature)?;

        let amounts = SwapRouterClient::new(&env, &router).swap_tokens_for_exact_tokens(
            &intent.amount,
            &amount_in_max,
            &path,
            &intent.customer,
            &deadline,
        );
        // The router returns what each hop cost; the first is what the customer
        // actually spent. It reports rather than enforces - the ceiling is the
        // router's own check, and above it the call has already failed.
        let amount_in = amounts.first().unwrap_or(amount_in_max);

        TokenClient::new(&env, &intent.token).transfer(
            &intent.customer,
            &intent.recipient,
            &intent.amount,
        );

        PaymentFunded {
            intent_id: intent.intent_id.clone(),
            source_token,
            customer: intent.customer.clone(),
            amount_in,
            amount_out: intent.amount,
        }
        .publish(&env);
        publish_settled(&env, intent);
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

/// Everything both settlement paths must agree on, in the order that keeps the
/// cheap refusals ahead of the expensive ones: context, then the merchant, then
/// the asset, then replay, then the two signatures.
///
/// Marking the intent consumed before any token moves is deliberate. The
/// customer's authorization and the merchant's signature are both checked by
/// this point, so a call that gets past here has earned the right to spend the
/// nonce, and a swap that fails afterwards takes the whole transaction with it.
fn authorize_intent(
    env: &Env,
    intent: &PaymentIntent,
    merchant_signature: &BytesN<64>,
) -> Result<(), Error> {
    validate_context(env, intent)?;
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
    let digest: BytesN<32> = env.crypto().sha256(&intent.clone().to_xdr(env)).into();
    let message: Bytes = digest.into();
    env.crypto()
        .ed25519_verify(&merchant.signing_key, &message, merchant_signature);

    env.storage().persistent().set(&consumed_key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&consumed_key, BUMP_THRESHOLD, BUMP_TO);
    env.storage()
        .persistent()
        .extend_ttl(&merchant_key, BUMP_THRESHOLD, BUMP_TO);
    env.storage()
        .persistent()
        .extend_ttl(&asset_key, BUMP_THRESHOLD, BUMP_TO);
    bump_instance_ttl(env);
    Ok(())
}

fn publish_settled(env: &Env, intent: PaymentIntent) {
    PaymentSettled {
        intent_id: intent.intent_id,
        merchant_id: intent.merchant_id,
        customer: intent.customer,
        recipient: intent.recipient,
        token: intent.token,
        amount: intent.amount,
    }
    .publish(env);
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
    env.storage().instance().extend_ttl(BUMP_THRESHOLD, BUMP_TO);
}

#[cfg(test)]
mod test;
