/**
 * Proves the wallet a customer actually gets: twelve words in, a settled payment
 * out, on real Testnet.
 *
 * The account is derived by the app's own module rather than a copy of it, so a
 * derivation bug fails here instead of in someone's hands. Friendbot funds it,
 * which is the same call the app makes when a wallet is created, and the payment
 * runs through the deployed settlement contract with the relayer as the fee
 * payer — the whole path the phone takes.
 *
 *   npm run testnet:phrase-wallet                 # a fresh phrase each run
 *   ROSAPAY_PHRASE="word word ..." npm run testnet:phrase-wallet
 */
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {Buffer} from 'node:buffer';
import {getPublicKey, hashes, sign} from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha2.js';
import {Asset, BASE_FEE, Horizon, Keypair, Operation, StrKey, TransactionBuilder} from '@stellar/stellar-sdk';
import {basicNodeSigner} from '@stellar/stellar-sdk/contract';
import {createPaymentIntent, hashPaymentIntent} from '@rosapay/protocol';
import {
  buildSettlementEnvelope,
  createSettlementClient,
  createStellarConfig,
  settleSignedPayment,
} from '@rosapay/stellar';
// The app's module, imported rather than reimplemented: this script is only
// evidence if it derives the account exactly the way the phone does.
import {
  generateRecoveryPhrase,
  keypairFromRecoveryPhrase,
} from '../apps/mobile/src/features/wallet/stellarKey.ts';

hashes.sha512 = sha512;

const deployment = JSON.parse(readFileSync('config/testnet-deployment.json', 'utf8'));
const configDir = process.env.ROSAPAY_STELLAR_CONFIG_DIR ?? `${process.env.HOME ?? ''}/.config/stellar`;
const amount = process.env.ROSAPAY_AMOUNT ?? '0.5';
/** XLM by default; `ROSAPAY_ASSET=USDC` exercises the credit-asset path. */
const assetCode = (process.env.ROSAPAY_ASSET ?? 'XLM').toUpperCase();
const usdc = deployment.registeredAssets?.find((entry: {code: string}) => entry.code === 'USDC');

function stellarCli(args: string[], {allowFailure = false} = {}) {
  const result = spawnSync('stellar', args, {encoding: 'utf8'});
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (!allowFailure && result.status !== 0) throw new Error(`Stellar CLI failed: ${output.trim()}`);
  return {status: result.status ?? 1, output};
}

function secretOf(identity: string, envVar?: string): string {
  const fromEnv = envVar ? process.env[envVar]?.trim() : undefined;
  if (fromEnv) {
    if (!/^S[A-Z2-7]{55}$/.test(fromEnv)) throw new Error(`${envVar} is not a Stellar secret key`);
    return fromEnv;
  }
  const output = stellarCli(['keys', 'show', identity, '--config-dir', configDir]).output;
  const secret = output.split('\n').map(line => line.trim()).find(line => /^S[A-Z2-7]{55}$/.test(line));
  if (!secret) throw new Error(`Could not read the secret key for ${identity}`);
  return secret;
}

/** The faucet the app calls for a wallet it has just created. */
async function fundWithFriendbot(address: string): Promise<void> {
  const response = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`);
  if (response.ok) return;
  // Friendbot refuses an account it has already funded, which is a success here.
  const existing = await fetch(`${deployment.horizonUrl}/accounts/${address}`);
  if (!existing.ok) throw new Error(`Friendbot would not fund ${address}: ${response.status}`);
}

async function latestLedger(rpcUrl: string): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getLatestLedger'}),
  });
  const body = (await response.json()) as {result?: {sequence?: number}};
  const sequence = body.result?.sequence;
  if (typeof sequence !== 'number') throw new Error('Stellar RPC did not return a ledger');
  return sequence;
}

async function balanceOf(horizon: Horizon.Server, address: string): Promise<string> {
  const account = await horizon.loadAccount(address);
  if (assetCode === 'XLM') {
    return account.balances.find(balance => balance.asset_type === 'native')?.balance ?? '0';
  }
  return (
    account.balances.find(
      balance => 'asset_code' in balance && balance.asset_code === assetCode && balance.asset_issuer === usdc.issuer,
    )?.balance ?? '0'
  );
}

/**
 * A credit asset only arrives where a trustline is already open, so the
 * recipient needs one before the contract is asked to move anything. Without it
 * the settlement fails with the customer already committed.
 */
async function ensureRecipientTrustline(horizon: Horizon.Server, keypair: Keypair, passphrase: string): Promise<void> {
  if (assetCode === 'XLM') return;
  const account = await horizon.loadAccount(keypair.publicKey());
  const open = account.balances.some(
    balance => 'asset_code' in balance && balance.asset_code === assetCode && balance.asset_issuer === usdc.issuer,
  );
  if (open) return;
  const transaction = new TransactionBuilder(account, {fee: BASE_FEE, networkPassphrase: passphrase})
    .addOperation(Operation.changeTrust({asset: new Asset(assetCode, usdc.issuer)}))
    .setTimeout(60)
    .build();
  transaction.sign(keypair);
  await horizon.submitTransaction(transaction);
  console.log(JSON.stringify({event: 'recipient_trustline_opened', address: keypair.publicKey(), asset: assetCode}));
}

async function main() {
  const phrase = process.env.ROSAPAY_PHRASE?.trim() || generateRecoveryPhrase();
  const customer = keypairFromRecoveryPhrase(phrase);

  console.log(JSON.stringify({event: 'wallet_derived', words: phrase.split(' ').length, address: customer.publicKey()}));

  const relayer = Keypair.fromSecret(secretOf('rosapay-testnet-relayer', 'STELLAR_RELAYER_SECRET'));
  const admin = Keypair.fromSecret(secretOf('rosapay-testnet-deployer', 'STELLAR_ADMIN_SECRET'));
  if (customer.publicKey() === relayer.publicKey()) throw new Error('Customer and relayer must differ');

  const config = createStellarConfig('testnet', {
    rpcUrl: deployment.rpcUrl,
    settlementContractId: deployment.settlementContractId,
  });
  const horizon = new Horizon.Server(config.horizonUrl);

  await fundWithFriendbot(customer.publicKey());
  const funded = await balanceOf(horizon, customer.publicKey());
  console.log(JSON.stringify({event: 'wallet_funded', address: customer.publicKey(), balance: funded}));

  // A fresh merchant per run, registered on-chain by the contract admin.
  const merchantSecret = Keypair.random().rawSecretKey();
  const merchantSigningKey = StrKey.encodeEd25519PublicKey(Buffer.from(await getPublicKey(merchantSecret)));
  const merchantProfileId = crypto.randomUUID();
  const recipient = admin.publicKey();

  await ensureRecipientTrustline(horizon, admin, config.networkPassphrase);

  const intent = createPaymentIntent({
    profile: {merchantProfileId, merchantName: 'Rose Coffee', merchantSigningKey, recipient, network: 'testnet'},
    amount,
    reference: 'Recovery-phrase wallet proof',
    latestLedger: await latestLedger(config.rpcUrl),
    intentId: crypto.randomUUID(),
    nonce: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex'),
    createdAt: new Date().toISOString(),
    ...(assetCode === 'XLM'
      ? {}
      : {asset: {type: 'credit' as const, code: assetCode, issuer: usdc.issuer, decimals: 7}}),
  });
  const payload = {
    intent,
    signature: Buffer.from(await sign(Buffer.from(hashPaymentIntent(intent), 'hex'), merchantSecret)).toString('base64'),
  };

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
    signing_key: Buffer.from(StrKey.decodeEd25519PublicKey(merchantSigningKey)),
    recipient,
  });
  const registered = await registration.signAndSend({signTransaction: adminSigner.signTransaction});
  console.log(JSON.stringify({event: 'merchant_registered', hash: registered.sendTransactionResponse?.hash}));

  // The digest names the payer, so the merchant can only sign it now.
  const digestClient = createSettlementClient(config, {publicKey: relayer.publicKey()});
  const digest = (await digestClient.intent_digest({intent: envelope.intent}, {simulate: true})).result;
  const merchantContractSignature = await sign(Buffer.from(digest), merchantSecret);

  const customerSigner = basicNodeSigner(customer, config.networkPassphrase);
  const relayerSigner = basicNodeSigner(relayer, config.networkPassphrase);
  const beforeCustomer = await balanceOf(horizon, customer.publicKey());
  const beforeRecipient = await balanceOf(horizon, recipient);

  const stages: string[] = [];
  const receipt = await settleSignedPayment({
    payload,
    config,
    customerAddress: customer.publicKey(),
    relayerAddress: relayer.publicKey(),
    latestLedger: await latestLedger(config.rpcUrl),
    merchantContractSignature,
    customerSigner: {signAuthEntry: customerSigner.signAuthEntry},
    relayerSigner: {signTransaction: relayerSigner.signTransaction},
    onProgress: progress => stages.push(progress.stage),
  });

  const transaction = await horizon.transactions().transaction(receipt.transactionHash).call();
  const afterCustomer = await balanceOf(horizon, customer.publicKey());
  const afterRecipient = await balanceOf(horizon, recipient);
  const customerDelta = Number(beforeCustomer) - Number(afterCustomer);
  const recipientDelta = Number(afterRecipient) - Number(beforeRecipient);

  const checks: string[] = [];
  const expect = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) throw new Error(`${label} failed: ${JSON.stringify(detail)}`);
    checks.push(label);
  };

  expect('pipeline-stages', ['simulated', 'authorized', 'submitted', 'confirmed'].every(s => stages.includes(s)), stages);
  expect('relayer-is-source', transaction.source_account === relayer.publicKey(), transaction.source_account);
  expect('relayer-pays-fee', transaction.fee_account === relayer.publicKey(), transaction.fee_account);
  // The whole point: a phrase-derived account authorized this without ever
  // being the transaction source, and paid the amount and nothing else.
  expect('customer-is-not-source', transaction.source_account !== customer.publicKey());
  expect('customer-pays-amount-only', Math.abs(customerDelta - Number(amount)) < 1e-7, {customerDelta, amount});
  expect('recipient-received-amount', Math.abs(recipientDelta - Number(amount)) < 1e-7, {recipientDelta});

  console.log(
    JSON.stringify(
      {
        network: 'testnet',
        derivation: "SEP-0005 m/44'/148'/0'",
        customer: customer.publicKey(),
        relayer: relayer.publicKey(),
        recipient,
        asset: assetCode,
        amount,
        transactionHash: receipt.transactionHash,
        ledger: receipt.ledger,
        sourceAccount: transaction.source_account,
        feeAccount: transaction.fee_account,
        feeCharged: transaction.fee_charged,
        customerDelta,
        recipientDelta,
        explorer: `https://stellar.expert/explorer/testnet/tx/${receipt.transactionHash}`,
        checks,
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
