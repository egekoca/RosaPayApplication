use super::*;
use ed25519_dalek::{Signer as _, SigningKey};
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{Address as _, Ledger as _},
    token::StellarAssetClient,
};

struct Fixture {
    env: Env,
    client: SettlementContractClient<'static>,
    customer: Address,
    recipient: Address,
    token: Address,
    merchant_id: BytesN<32>,
    signing_key: SigningKey,
}

fn fixture() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(1_000);
    let admin = Address::generate(&env);
    let customer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();
    StellarAssetClient::new(&env, &token).mint(&customer, &1_000_000);

    let contract_id = env.register(SettlementContract, (admin, token.clone()));
    let client = SettlementContractClient::new(&env, &contract_id);
    let merchant_id = BytesN::from_array(&env, &[3; 32]);
    let signing_key = SigningKey::from_bytes(&[7; 32]);
    client.register_merchant(
        &merchant_id,
        &BytesN::from_array(&env, signing_key.verifying_key().as_bytes()),
        &recipient,
    );
    Fixture {
        env,
        client,
        customer,
        recipient,
        token,
        merchant_id,
        signing_key,
    }
}

fn intent(f: &Fixture) -> PaymentIntent {
    PaymentIntent {
        network_id: f.env.ledger().network_id(),
        settlement_contract: f.client.address.clone(),
        intent_id: BytesN::from_array(&f.env, &[9; 32]),
        nonce: BytesN::from_array(&f.env, &[11; 32]),
        merchant_id: f.merchant_id.clone(),
        customer: f.customer.clone(),
        recipient: f.recipient.clone(),
        token: f.token.clone(),
        amount: 250_000,
        expires_at_ledger: 1_120,
    }
}

fn sign(f: &Fixture, intent: &PaymentIntent) -> BytesN<64> {
    let digest = f.client.intent_digest(intent);
    let signature = f.signing_key.sign(&digest.to_array()).to_bytes();
    BytesN::from_array(&f.env, &signature)
}

#[test]
fn settles_an_exact_authorized_payment() {
    let f = fixture();
    let intent = intent(&f);
    let signature = sign(&f, &intent);
    f.client.settle_payment(&intent, &signature);
    let token = TokenClient::new(&f.env, &f.token);
    assert_eq!(token.balance(&f.customer), 750_000);
    assert_eq!(token.balance(&f.recipient), 250_000);
    assert!(f.client.is_intent_consumed(&intent.intent_id));
}

#[test]
fn rejects_replay() {
    let f = fixture();
    let intent = intent(&f);
    let signature = sign(&f, &intent);
    f.client.settle_payment(&intent, &signature);
    assert_eq!(
        f.client.try_settle_payment(&intent, &signature),
        Err(Ok(Error::IntentConsumed))
    );
}

#[test]
fn rejects_expired_recipient_asset_and_amount_mutations() {
    let f = fixture();

    let mut expired = intent(&f);
    expired.expires_at_ledger = 1_000;
    assert_eq!(
        f.client.try_settle_payment(&expired, &sign(&f, &expired)),
        Err(Ok(Error::IntentExpired))
    );

    let mut recipient_swapped = intent(&f);
    recipient_swapped.recipient = Address::generate(&f.env);
    assert_eq!(
        f.client
            .try_settle_payment(&recipient_swapped, &sign(&f, &recipient_swapped)),
        Err(Ok(Error::RecipientMismatch))
    );

    let mut invalid_amount = intent(&f);
    invalid_amount.amount = 0;
    assert_eq!(
        f.client
            .try_settle_payment(&invalid_amount, &sign(&f, &invalid_amount)),
        Err(Ok(Error::InvalidAmount))
    );

    let token_admin = Address::generate(&f.env);
    let unsupported = f
        .env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    let mut asset_swapped = intent(&f);
    asset_swapped.token = unsupported;
    assert_eq!(
        f.client
            .try_settle_payment(&asset_swapped, &sign(&f, &asset_swapped)),
        Err(Ok(Error::UnsupportedAsset))
    );
}

#[test]
fn changed_amount_invalidates_merchant_signature() {
    let f = fixture();
    let original = intent(&f);
    let signature = sign(&f, &original);
    let mut changed = original;
    changed.amount += 1;
    assert!(f.client.try_settle_payment(&changed, &signature).is_err());
}

// ---------------------------------------------------------------------------
// Funding a payment through a swap
// ---------------------------------------------------------------------------

/// Stands in for Soroswap's router with a fixed price, so these tests can say
/// what a pool charged without depending on one.
///
/// It mirrors the real router where it matters: it asks `to` to authorize, it
/// pulls the input from `to` rather than from itself, it refuses an input above
/// the ceiling, and it hands back the per-hop amounts. What it does not have is
/// a curve, because none of these tests are about the price.
#[contract]
pub struct MockRouter;

#[contractimpl]
impl MockRouter {
    pub fn __constructor(env: Env, price_num: i128, price_den: i128) {
        env.storage().instance().set(&symbol_short!("num"), &price_num);
        env.storage().instance().set(&symbol_short!("den"), &price_den);
    }

    pub fn swap_tokens_for_exact_tokens(
        env: Env,
        amount_out: i128,
        amount_in_max: i128,
        path: Vec<Address>,
        to: Address,
        deadline: u64,
    ) -> Vec<i128> {
        to.require_auth();
        assert!(env.ledger().timestamp() < deadline, "deadline passed");
        // The reserves live in this contract, as a pair's do, so paying the
        // output out needs no authorization from anyone but itself.
        let pool = env.current_contract_address();
        let num: i128 = env.storage().instance().get(&symbol_short!("num")).unwrap();
        let den: i128 = env.storage().instance().get(&symbol_short!("den")).unwrap();
        let amount_in = amount_out * num / den;
        assert!(amount_in <= amount_in_max, "excessive input amount");
        TokenClient::new(&env, &path.first().unwrap()).transfer(&to, &pool, &amount_in);
        TokenClient::new(&env, &path.last().unwrap()).transfer(&pool, &to, &amount_out);
        soroban_sdk::vec![&env, amount_in, amount_out]
    }
}

struct SwapFixture {
    f: Fixture,
    /// What the customer actually holds.
    source: Address,
    path: Vec<Address>,
}

/// A customer holding a million of one token, and a router that sells the
/// merchant's token for three of it.
fn swap_fixture() -> SwapFixture {
    let f = fixture();
    let source = f
        .env
        .register_stellar_asset_contract_v2(Address::generate(&f.env))
        .address();
    StellarAssetClient::new(&f.env, &source).mint(&f.customer, &1_000_000);

    // The router holds the reserve of the merchant's token and takes in the
    // customer's, the way a pair contract does.
    let router = f.env.register(MockRouter, (3_i128, 1_i128));
    StellarAssetClient::new(&f.env, &f.token).mint(&router, &1_000_000);
    f.client.set_swap_router(&router);

    let path = soroban_sdk::vec![&f.env, source.clone(), f.token.clone()];
    SwapFixture { f, source, path }
}

/// Spends the customer's balance of the merchant's token, so the swap is the
/// only way the payment can happen.
fn empty_the_customer(f: &Fixture) {
    let token = TokenClient::new(&f.env, &f.token);
    let held = token.balance(&f.customer);
    token.transfer(&f.customer, &Address::generate(&f.env), &held);
}

#[test]
fn funds_a_payment_from_a_token_the_customer_actually_holds() {
    let s = swap_fixture();
    empty_the_customer(&s.f);
    let intent = intent(&s.f);
    let signature = sign(&s.f, &intent);
    assert_eq!(
        TokenClient::new(&s.f.env, &s.f.token).balance(&s.f.customer),
        0
    );

    s.f.client
        .settle_payment_with_swap(&intent, &signature, &s.path, &1_000_000, &u64::MAX);

    // The merchant is paid the exact amount they signed for, in their own token.
    assert_eq!(
        TokenClient::new(&s.f.env, &s.f.token).balance(&s.f.recipient),
        250_000
    );
    // Nothing is left over: the swap bought the payment, not a balance.
    assert_eq!(
        TokenClient::new(&s.f.env, &s.f.token).balance(&s.f.customer),
        0
    );
    // And it was paid for out of the token they had, at the router's price.
    assert_eq!(
        TokenClient::new(&s.f.env, &s.source).balance(&s.f.customer),
        1_000_000 - 750_000
    );
    assert!(s.f.client.is_intent_consumed(&intent.intent_id));
}

#[test]
fn the_price_moves_what_the_customer_spends_and_never_what_the_merchant_gets() {
    for (price, expected_spend) in [(1_i128, 250_000_i128), (2, 500_000), (3, 750_000)] {
        let f = fixture();
        let source = f
            .env
            .register_stellar_asset_contract_v2(Address::generate(&f.env))
            .address();
        StellarAssetClient::new(&f.env, &source).mint(&f.customer, &1_000_000);
        let router = f.env.register(MockRouter, (price, 1_i128));
        StellarAssetClient::new(&f.env, &f.token).mint(&router, &1_000_000);
        f.client.set_swap_router(&router);
        let path = soroban_sdk::vec![&f.env, source.clone(), f.token.clone()];
        empty_the_customer(&f);

        let intent = intent(&f);
        let signature = sign(&f, &intent);
        f.client
            .settle_payment_with_swap(&intent, &signature, &path, &1_000_000, &u64::MAX);

        assert_eq!(
            TokenClient::new(&f.env, &f.token).balance(&f.recipient),
            250_000
        );
        assert_eq!(
            TokenClient::new(&f.env, &source).balance(&f.customer),
            1_000_000 - expected_spend
        );
    }
}

#[test]
fn refuses_a_path_that_does_not_end_where_the_merchant_asked() {
    let s = swap_fixture();
    let intent = intent(&s.f);
    let signature = sign(&s.f, &intent);

    let elsewhere = s
        .f
        .env
        .register_stellar_asset_contract_v2(Address::generate(&s.f.env))
        .address();

    // Ends at a token the merchant never named.
    let wrong_end = soroban_sdk::vec![&s.f.env, s.source.clone(), elsewhere];
    assert_eq!(
        s.f.client.try_settle_payment_with_swap(
            &intent,
            &signature,
            &wrong_end,
            &1_000_000,
            &u64::MAX
        ),
        Err(Ok(Error::InvalidSwapPath))
    );

    // Starts where it ends, which buys nothing and only costs a fee.
    let no_op = soroban_sdk::vec![&s.f.env, s.f.token.clone(), s.f.token.clone()];
    assert_eq!(
        s.f.client
            .try_settle_payment_with_swap(&intent, &signature, &no_op, &1_000_000, &u64::MAX),
        Err(Ok(Error::InvalidSwapPath))
    );

    // Not a path at all.
    let empty = soroban_sdk::vec![&s.f.env];
    assert_eq!(
        s.f.client
            .try_settle_payment_with_swap(&intent, &signature, &empty, &1_000_000, &u64::MAX),
        Err(Ok(Error::InvalidSwapPath))
    );

    assert!(!s.f.client.is_intent_consumed(&intent.intent_id));
}

#[test]
fn refuses_a_swap_with_no_ceiling() {
    let s = swap_fixture();
    let intent = intent(&s.f);
    let signature = sign(&s.f, &intent);
    for limit in [0_i128, -1] {
        assert_eq!(
            s.f.client
                .try_settle_payment_with_swap(&intent, &signature, &s.path, &limit, &u64::MAX),
            Err(Ok(Error::InvalidSwapLimit))
        );
    }
}

#[test]
fn a_price_above_the_ceiling_costs_the_customer_nothing() {
    let s = swap_fixture();
    empty_the_customer(&s.f);
    let intent = intent(&s.f);
    let signature = sign(&s.f, &intent);

    // The router wants 750_000 and is offered one less.
    assert!(s
        .f
        .client
        .try_settle_payment_with_swap(&intent, &signature, &s.path, &749_999, &u64::MAX)
        .is_err());

    assert_eq!(
        TokenClient::new(&s.f.env, &s.source).balance(&s.f.customer),
        1_000_000
    );
    assert_eq!(
        TokenClient::new(&s.f.env, &s.f.token).balance(&s.f.recipient),
        0
    );
    // The nonce survives a failed payment, so the customer can try again.
    assert!(!s.f.client.is_intent_consumed(&intent.intent_id));
}

#[test]
fn refuses_to_swap_before_a_router_is_named() {
    let f = fixture();
    let source = f
        .env
        .register_stellar_asset_contract_v2(Address::generate(&f.env))
        .address();
    let path = soroban_sdk::vec![&f.env, source, f.token.clone()];
    let intent = intent(&f);
    let signature = sign(&f, &intent);
    assert_eq!(f.client.swap_router(), None);
    assert_eq!(
        f.client
            .try_settle_payment_with_swap(&intent, &signature, &path, &1_000_000, &u64::MAX),
        Err(Ok(Error::SwapRouterNotSet))
    );
}

#[test]
fn the_swap_path_keeps_every_check_the_direct_path_makes() {
    let s = swap_fixture();
    empty_the_customer(&s.f);

    // Replay.
    let intent = intent(&s.f);
    let signature = sign(&s.f, &intent);
    s.f.client
        .settle_payment_with_swap(&intent, &signature, &s.path, &1_000_000, &u64::MAX);
    assert_eq!(
        s.f.client
            .try_settle_payment_with_swap(&intent, &signature, &s.path, &1_000_000, &u64::MAX),
        Err(Ok(Error::IntentConsumed))
    );

    // Expiry.
    let mut expired = intent.clone();
    expired.intent_id = BytesN::from_array(&s.f.env, &[21; 32]);
    expired.expires_at_ledger = 1_000;
    assert_eq!(
        s.f.client.try_settle_payment_with_swap(
            &expired,
            &sign(&s.f, &expired),
            &s.path,
            &1_000_000,
            &u64::MAX
        ),
        Err(Ok(Error::IntentExpired))
    );

    // A recipient the merchant is not registered against.
    let mut recipient_swapped = intent.clone();
    recipient_swapped.intent_id = BytesN::from_array(&s.f.env, &[22; 32]);
    recipient_swapped.recipient = Address::generate(&s.f.env);
    assert_eq!(
        s.f.client.try_settle_payment_with_swap(
            &recipient_swapped,
            &sign(&s.f, &recipient_swapped),
            &s.path,
            &1_000_000,
            &u64::MAX
        ),
        Err(Ok(Error::RecipientMismatch))
    );

    // An asset the contract was never told about.
    let mut asset_swapped = intent.clone();
    asset_swapped.intent_id = BytesN::from_array(&s.f.env, &[23; 32]);
    asset_swapped.token = s
        .f
        .env
        .register_stellar_asset_contract_v2(Address::generate(&s.f.env))
        .address();
    let unsupported_path =
        soroban_sdk::vec![&s.f.env, s.source.clone(), asset_swapped.token.clone()];
    assert_eq!(
        s.f.client.try_settle_payment_with_swap(
            &asset_swapped,
            &sign(&s.f, &asset_swapped),
            &unsupported_path,
            &1_000_000,
            &u64::MAX
        ),
        Err(Ok(Error::UnsupportedAsset))
    );
}

#[test]
fn a_changed_amount_still_invalidates_the_merchant_signature_when_swapping() {
    let s = swap_fixture();
    empty_the_customer(&s.f);
    let original = intent(&s.f);
    let signature = sign(&s.f, &original);
    let mut changed = original;
    changed.amount += 1;
    assert!(s
        .f
        .client
        .try_settle_payment_with_swap(&changed, &signature, &s.path, &1_000_000, &u64::MAX)
        .is_err());
    assert_eq!(
        TokenClient::new(&s.f.env, &s.f.token).balance(&s.f.recipient),
        0
    );
}
