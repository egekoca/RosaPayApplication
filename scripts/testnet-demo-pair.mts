/**
 * Creates two fresh Testnet accounts and moves real XLM between them through
 * RosaSettlement, so there is a funded pair to test with and a transaction hash
 * that proves the contract path end to end.
 *
 * The two accounts are the ones a demo actually needs:
 *   - a customer that pays, holding its own XLM
 *   - a merchant that receives, registered on the settlement contract
 *
 * Both are written to `config/testnet-demo-pair.json` so a later run reuses them
 * instead of littering the network with abandoned accounts. Delete that file to
 * start over with a new pair.
 */
import {randomUUID, getRandomValues} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {Buffer} from 'node:buffer';
import {Horizon, Keypair, StrKey} from '@stellar/stellar-sdk';
import {basicNodeSigner} from '@stellar/stellar-sdk/contract';
import {getPublicKey, hashes, sign} from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha2.js';
import {createPaymentIntent, hashPaymentIntent} from '@rosapay/protocol';
import {
  buildSettlementEnvelope,
  createSettlementClient,
  createStellarConfig,
  settleSignedPayment,
} from '@rosapay/stellar';

// @noble/ed25519 needs a sync SHA-512 to sign without awaiting a hash.
hashes.sha512 = sha512;

const deployment = JSON.parse(readFileSync('config/testnet-deployment.json', 'utf8'));
const pairPath = process.env.ROSAPAY_DEMO_PAIR ?? 'config/testnet-demo-pair.json';
const amount = process.env.ROSAPAY_DEMO_AMOUNT ?? '2.5';
const FRIENDBOT = 'https://friendbot.stellar.org';

type Pair = {
  customerSecret: string;
  merchantRecipient: string;
  merchantRecipientSecret: string;
  merchantSigningSecretHex: string;
  merchantProfileId: string;
  merchantName: string;
};

function relayerKeypair(): Keypair {
  const secret = process.env.STELLAR_RELAYER_SECRET?.trim();
  if (!secret) throw new Error('STELLAR_RELAYER_SECRET is not set — copy .env.example to .env and fill it in');
  return Keypair.fromSecret(secret);
}

function adminKeypair(): Keypair {
  const secret = process.env.STELLAR_ADMIN_SECRET?.trim();
  if (!secret) throw new Error('STELLAR_ADMIN_SECRET is not set — copy .env.example to .env and fill it in');
  return Keypair.fromSecret(secret);
}

/** Friendbot both creates and funds, so a missing account and an empty one are the same case. */
async function fund(address: string): Promise<void> {
  const response = await fetch(`${FRIENDBOT}?addr=${address}`);
  if (response.ok) return;
  const body = await response.text();
  if (body.includes('op_already_exists') || body.includes('createAccountAlreadyExist')) return;
  throw new Error(`Friendbot refused ${address}: ${body.slice(0, 200)}`);
}

async function nativeBalance(horizon: Horizon.Server, address: string): Promise<number> {
  const account = await horizon.loadAccount(address);
  return Number(account.balances.find(balance => balance.asset_type === 'native')?.balance ?? '0');
}

async function loadOrCreatePair(): Promise<{pair: Pair; created: boolean}> {
  if (existsSync(pairPath)) {
    return {pair: JSON.parse(readFileSync(pairPath, 'utf8')) as Pair, created: false};
  }
  const customer = Keypair.random();
  const merchantRecipient = Keypair.random();
  const merchantSigningSecret = getRandomValues(new Uint8Array(32));
  const pair: Pair = {
    customerSecret: customer.secret(),
    merchantRecipient: merchantRecipient.publicKey(),
    merchantRecipientSecret: merchantRecipient.secret(),
    merchantSigningSecretHex: Buffer.from(merchantSigningSecret).toString('hex'),
    merchantProfileId: randomUUID(),
    merchantName: 'Rosa Demo Store',
  };
  writeFileSync(pairPath, `${JSON.stringify(pair, null, 2)}\n`);
  return {pair, created: true};
}

async function latestLedger(rpcUrl: string): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getLatestLedger'}),
  });
  const body = (await response.json()) as {result?: {sequence?: number}};
  const sequence = body.result?.sequence;
  if (!sequence) throw new Error('Could not read the latest ledger');
  return sequence;
}

async function main() {
  const {pair, created} = await loadOrCreatePair();
  const customer = Keypair.fromSecret(pair.customerSecret);
  const relayer = relayerKeypair();
  const admin = adminKeypair();
  const merchantSigningSecret = Uint8Array.from(Buffer.from(pair.merchantSigningSecretHex, 'hex'));
  const merchantSigningKey = StrKey.encodeEd25519PublicKey(
    Buffer.from(await getPublicKey(merchantSigningSecret)),
  );

  console.log(created ? 'Created a new demo pair.\n' : 'Reusing the demo pair on disk.\n');
  await fund(customer.publicKey());
  await fund(pair.merchantRecipient);

  const config = createStellarConfig('testnet', {
    rpcUrl: deployment.rpcUrl,
    settlementContractId: deployment.settlementContractId,
  });
  const horizon = new Horizon.Server(config.horizonUrl);

  const intent = createPaymentIntent({
    profile: {
      merchantProfileId: pair.merchantProfileId,
      merchantName: pair.merchantName,
      merchantSigningKey,
      recipient: pair.merchantRecipient,
      network: 'testnet',
    },
    amount,
    reference: 'Demo pair settlement',
    latestLedger: await latestLedger(config.rpcUrl),
    intentId: randomUUID(),
    nonce: Buffer.from(getRandomValues(new Uint8Array(16))).toString('hex'),
    createdAt: new Date().toISOString(),
  });
  const payload = {
    intent,
    signature: Buffer.from(
      await sign(Buffer.from(hashPaymentIntent(intent), 'hex'), merchantSigningSecret),
    ).toString('base64'),
  };

  const envelope = buildSettlementEnvelope(intent, {
    customer: customer.publicKey(),
    networkPassphrase: config.networkPassphrase,
    settlementContractId: deployment.settlementContractId,
  });

  // The contract only accepts a merchant it knows, so register this pair's
  // merchant once. Registering an already-registered merchant is harmless.
  const adminSigner = basicNodeSigner(admin, config.networkPassphrase);
  const adminClient = createSettlementClient(config, {
    publicKey: admin.publicKey(),
    signTransaction: adminSigner.signTransaction,
  });
  const registration = await adminClient.register_merchant({
    merchant_id: envelope.intent.merchant_id,
    signing_key: Buffer.from(StrKey.decodeEd25519PublicKey(merchantSigningKey)),
    recipient: pair.merchantRecipient,
  });
  await registration.signAndSend({signTransaction: adminSigner.signTransaction});

  // The merchant signs a digest that names this exact customer, which is why it
  // can only be produced once the payer is known.
  const digestClient = createSettlementClient(config, {publicKey: relayer.publicKey()});
  const digest = (await digestClient.intent_digest({intent: envelope.intent}, {simulate: true})).result;
  const merchantContractSignature = await sign(Buffer.from(digest), merchantSigningSecret);

  const before = {
    customer: await nativeBalance(horizon, customer.publicKey()),
    merchant: await nativeBalance(horizon, pair.merchantRecipient),
  };

  const customerSigner = basicNodeSigner(customer, config.networkPassphrase);
  const relayerSigner = basicNodeSigner(relayer, config.networkPassphrase);
  const receipt = await settleSignedPayment({
    payload,
    config,
    customerAddress: customer.publicKey(),
    relayerAddress: relayer.publicKey(),
    latestLedger: await latestLedger(config.rpcUrl),
    merchantContractSignature,
    customerSigner: {signAuthEntry: customerSigner.signAuthEntry},
    relayerSigner: {signTransaction: relayerSigner.signTransaction},
  });

  const after = {
    customer: await nativeBalance(horizon, customer.publicKey()),
    merchant: await nativeBalance(horizon, pair.merchantRecipient),
  };

  console.log('Customer  (pays)');
  console.log(`  ${customer.publicKey()}`);
  console.log(`  ${before.customer} -> ${after.customer} XLM\n`);
  console.log('Merchant  (receives)');
  console.log(`  ${pair.merchantRecipient}`);
  console.log(`  ${before.merchant} -> ${after.merchant} XLM\n`);
  console.log(`Moved ${amount} XLM through RosaSettlement, with the relayer paying the fee.`);
  console.log(`  tx     ${receipt.transactionHash}`);
  console.log(`  ledger ${receipt.ledger}`);
  console.log(`  https://stellar.expert/explorer/testnet/tx/${receipt.transactionHash}\n`);
  console.log('To receive into this merchant from the app, use this address in the business profile:');
  console.log(`  ${pair.merchantRecipient}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
