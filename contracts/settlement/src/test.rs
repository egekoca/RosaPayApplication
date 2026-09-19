use super::*;
use ed25519_dalek::{Signer as _, SigningKey};
use soroban_sdk::{
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
