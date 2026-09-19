/**
 * Proves a payment between two parties that never share a key.
 *
 * The settlement contract verifies a merchant signature over a digest that names
 * the payer, so the merchant can only produce it once a customer has claimed the
 * request. This script plays both sides through the API, with the customer half
 * holding no merchant material at all:
 *
 *   merchant  publishes a request, then countersigns for whoever claims it
 *   customer  claims the request, collects the signature, and pays
 *
 * If the customer half could sign for the merchant, the proof would be worthless,
 * so the merchant's signing secret is deliberately confined to one closure.
 */
import {randomUUID, getRandomValues} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Buffer} from 'node:buffer';
import {getPublicKey, hashes, sign} from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha2.js';
import {Horizon, Keypair, StrKey} from '@stellar/stellar-sdk';
import {basicNodeSigner} from '@stellar/stellar-sdk/contract';
import {createPaymentIntent, hashPaymentIntent} from '@rosapay/protocol';
import {
  buildSettlementEnvelope,
  createSettlementClient,
  createStellarConfig,
  settleSignedPayment,
} from '@rosapay/stellar';

hashes.sha512 = sha512;

const deployment = JSON.parse(readFileSync('config/testnet-deployment.json', 'utf8'));
const pair = JSON.parse(readFileSync(process.env.ROSAPAY_DEMO_PAIR ?? 'config/testnet-demo-pair.json', 'utf8'));
const baseUrl = process.env.ROSAPAY_API_URL ?? 'http://127.0.0.1:4100';
const amount = process.env.ROSAPAY_DEMO_AMOUNT ?? '1.5';

async function api(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {accept: 'application/json', ...(init?.body ? {'content-type': 'application/json'} : {}), ...init?.headers},
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function latestLedger(rpcUrl: string): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getLatestLedger'}),
  });
  return (await response.json()).result.sequence as number;
}

async function main() {
  const config = createStellarConfig('testnet', {
    rpcUrl: deployment.rpcUrl,
    settlementContractId: deployment.settlementContractId,
  });
  const horizon = new Horizon.Server(config.horizonUrl);
  const customer = Keypair.fromSecret(pair.customerSecret);
  const relayer = Keypair.fromSecret(process.env.STELLAR_RELAYER_SECRET!.trim());
  const admin = Keypair.fromSecret(process.env.STELLAR_ADMIN_SECRET!.trim());

  // Everything the merchant knows, including the secret nobody else may hold.
  const merchant = await (async () => {
    const signingSecret = Uint8Array.from(Buffer.from(pair.merchantSigningSecretHex, 'hex'));
    const signingKey = StrKey.encodeEd25519PublicKey(Buffer.from(await getPublicKey(signingSecret)));
    return {
      signingKey,
      recipient: pair.merchantRecipient as string,
      profileId: pair.merchantProfileId as string,
      name: pair.merchantName as string,
      signIntent: (bytes: Uint8Array) => sign(bytes, signingSecret),
      countersign: (digest: Uint8Array) => sign(digest, signingSecret),
    };
  })();

  // --- merchant: make and publish a request -------------------------------
  const intent = createPaymentIntent({
    profile: {
      merchantProfileId: merchant.profileId,
      merchantName: merchant.name,
      merchantSigningKey: merchant.signingKey,
      recipient: merchant.recipient,
      network: 'testnet',
    },
    amount,
    reference: 'Two-device proof',
    latestLedger: await latestLedger(config.rpcUrl),
    intentId: randomUUID(),
    nonce: Buffer.from(getRandomValues(new Uint8Array(16))).toString('hex'),
    createdAt: new Date().toISOString(),
  });
  const payload = {
    intent,
    signature: Buffer.from(await merchant.signIntent(Buffer.from(hashPaymentIntent(intent), 'hex'))).toString('base64'),
  };
  await api('/v1/payment-intents', {
    method: 'POST',
    headers: {'idempotency-key': `intent-${intent.intentId}`},
    body: JSON.stringify(payload),
  });
  console.log(`merchant  published ${amount} XLM request ${intent.intentId}`);

  // Register the merchant on the contract if this pair is new to it.
  const envelope = buildSettlementEnvelope(intent, {
    customer: customer.publicKey(),
    networkPassphrase: config.networkPassphrase,
    settlementContractId: deployment.settlementContractId,
  });
  const adminSigner = basicNodeSigner(admin, config.networkPassphrase);
  const adminClient = createSettlementClient(config, {
    publicKey: admin.publicKey(),
    signTransaction: adminSigner.signTransaction,
  });
  const registration = await adminClient.register_merchant({
    merchant_id: envelope.intent.merchant_id,
    signing_key: Buffer.from(StrKey.decodeEd25519PublicKey(merchant.signingKey)),
    recipient: merchant.recipient,
  });
  await registration.signAndSend({signTransaction: adminSigner.signTransaction});

  // --- customer: claim the request ----------------------------------------
  await api(`/v1/payment-intents/${intent.intentId}/countersignature/request`, {
    method: 'POST',
    body: JSON.stringify({customerAddress: customer.publicKey()}),
  });
  console.log(`customer  claimed it as ${customer.publicKey()}`);

  // --- merchant: sign for that exact customer ------------------------------
  const claim = await api(`/v1/payment-intents/${intent.intentId}/countersignature`);
  const digestClient = createSettlementClient(config, {publicKey: relayer.publicKey()});
  const digest = (await digestClient.intent_digest({intent: envelope.intent}, {simulate: true})).result;
  await api(`/v1/payment-intents/${intent.intentId}/countersignature`, {
    method: 'POST',
    body: JSON.stringify({
      customerAddress: claim.customerAddress,
      signature: Buffer.from(await merchant.countersign(Uint8Array.from(digest))).toString('base64'),
    }),
  });
  console.log('merchant  countersigned for that customer');

  // --- customer: collect and pay, holding no merchant material -------------
  const collected = await api(`/v1/payment-intents/${intent.intentId}/countersignature`);
  if (!collected.signature) throw new Error('The merchant signature was never published');

  const before = Number((await horizon.loadAccount(merchant.recipient)).balances.find(b => b.asset_type === 'native')!.balance);
  const customerSigner = basicNodeSigner(customer, config.networkPassphrase);
  const relayerSigner = basicNodeSigner(relayer, config.networkPassphrase);
  const receipt = await settleSignedPayment({
    payload,
    config,
    customerAddress: customer.publicKey(),
    relayerAddress: relayer.publicKey(),
    latestLedger: await latestLedger(config.rpcUrl),
    merchantContractSignature: Uint8Array.from(Buffer.from(collected.signature, 'base64')),
    customerSigner: {signAuthEntry: customerSigner.signAuthEntry},
    relayerSigner: {signTransaction: relayerSigner.signTransaction},
  });
  const after = Number((await horizon.loadAccount(merchant.recipient)).balances.find(b => b.asset_type === 'native')!.balance);

  const received = Math.round((after - before) * 1e7) / 1e7;
  if (Math.abs(received - Number(amount)) > 1e-7) {
    throw new Error(`Merchant received ${received}, expected ${amount}`);
  }

  console.log(`customer  paid, holding no merchant key\n`);
  console.log(`Merchant received ${received} XLM.`);
  console.log(`  tx     ${receipt.transactionHash}`);
  console.log(`  ledger ${receipt.ledger}`);
  console.log(`  https://stellar.expert/explorer/testnet/tx/${receipt.transactionHash}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
