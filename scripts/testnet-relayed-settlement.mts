/**
 * Proves the RTP/1 relayed settlement model on Testnet: the customer authorizes
 * one exact invocation, and a separate relayer account is the transaction source
 * and fee payer. This is the on-chain evidence for "may submit" and "may spend"
 * living with different actors.
 */
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {getPublicKey, hashes, sign} from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha2.js';
import {Horizon, Keypair, StrKey} from '@stellar/stellar-sdk';
import {basicNodeSigner} from '@stellar/stellar-sdk/contract';
import {Buffer} from 'node:buffer';
import {createPaymentIntent, hashPaymentIntent} from '@rosapay/protocol';
import {
  buildSettlementEnvelope,
  createSettlementClient,
  createStellarConfig,
  settleSignedPayment,
} from '@rosapay/stellar';

hashes.sha512 = sha512;

const deployment = JSON.parse(readFileSync('config/testnet-deployment.json', 'utf8'));
const configDir = process.env.ROSAPAY_STELLAR_CONFIG_DIR ?? '.stellar';
const adminIdentity = process.env.ROSAPAY_ADMIN_IDENTITY ?? 'rosapay-testnet-deployer';
const customerIdentity = process.env.ROSAPAY_CUSTOMER_IDENTITY ?? 'rosapay-testnet-customer';
const relayerIdentity = process.env.ROSAPAY_RELAYER_IDENTITY ?? 'rosapay-testnet-relayer';
const evidencePath = process.env.ROSAPAY_RELAYED_EVIDENCE ?? 'config/testnet-relayed-evidence.json';
const amount = '0.1';

function stellarCli(args: string[], {allowFailure = false} = {}) {
  const result = spawnSync('stellar', args, {encoding: 'utf8'});
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (!allowFailure && result.status !== 0) throw new Error(`Stellar CLI failed: ${output.trim()}`);
  return {status: result.status ?? 1, stdout: result.stdout?.trim() ?? '', output};
}

function secretOf(identity: string): string {
  const output = stellarCli(['keys', 'show', identity, '--config-dir', configDir]).output;
  const secret = output.split('\n').map(line => line.trim()).find(line => /^S[A-Z2-7]{55}$/.test(line));
  if (!secret) throw new Error(`Could not read the secret key for ${identity}`);
  return secret;
}

function ensureIdentity(identity: string): void {
  const exists = stellarCli(['keys', 'public-key', identity, '--config-dir', configDir], {allowFailure: true});
  if (exists.status === 0) return;
  console.log(`Creating and funding ${identity}`);
  stellarCli(['keys', 'generate', identity, '--config-dir', configDir, '--network', deployment.network, '--fund']);
}

async function main() {
  ensureIdentity(relayerIdentity);
  const customer = Keypair.fromSecret(secretOf(customerIdentity));
  const relayer = Keypair.fromSecret(secretOf(relayerIdentity));
  const admin = Keypair.fromSecret(secretOf(adminIdentity));
  if (customer.publicKey() === relayer.publicKey()) throw new Error('Customer and relayer must be different accounts');

  const config = createStellarConfig('testnet', {
    rpcUrl: deployment.rpcUrl,
    settlementContractId: deployment.settlementContractId,
  });
  const horizon = new Horizon.Server(config.horizonUrl);

  // A fresh merchant identity per run, registered on-chain by the contract admin.
  const merchantSecret = Keypair.random().rawSecretKey();
  const merchantSigningKey = StrKey.encodeEd25519PublicKey(Buffer.from(await getPublicKey(merchantSecret)));
  const merchantProfileId = crypto.randomUUID();
  const recipient = admin.publicKey();

  const intent = createPaymentIntent({
    profile: {merchantProfileId, merchantName: 'Rose Coffee', merchantSigningKey, recipient, network: 'testnet'},
    amount,
    reference: 'Relayed settlement proof',
    latestLedger: await latestLedger(config.rpcUrl),
    intentId: crypto.randomUUID(),
    nonce: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex'),
    createdAt: new Date().toISOString(),
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

  // Admin registers the merchant that this run's requests are signed with.
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
  console.log(JSON.stringify({event: 'merchant_registered', merchantProfileId, hash: registered.sendTransactionResponse?.hash}));

  // The merchant signs the contract digest for this exact customer.
  const digestClient = createSettlementClient(config, {publicKey: relayer.publicKey()});
  const digest = (await digestClient.intent_digest({intent: envelope.intent}, {simulate: true})).result;
  const merchantContractSignature = await sign(Buffer.from(digest), merchantSecret);

  const customerSigner = basicNodeSigner(customer, config.networkPassphrase);
  const relayerSigner = basicNodeSigner(relayer, config.networkPassphrase);
  const before = await balances(horizon, customer.publicKey(), relayer.publicKey(), recipient);

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
  const after = await balances(horizon, customer.publicKey(), relayer.publicKey(), recipient);
  const customerDelta = Number(before.customer) - Number(after.customer);
  const relayerDelta = Number(before.relayer) - Number(after.relayer);
  const recipientDelta = Number(after.recipient) - Number(before.recipient);

  const checks: string[] = [];
  const expect = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) throw new Error(`${label} failed: ${JSON.stringify(detail)}`);
    checks.push(label);
  };

  expect('pipeline-stages', ['simulated', 'authorized', 'submitted', 'confirmed'].every(stage => stages.includes(stage)), stages);
  expect('relayer-is-source', transaction.source_account === relayer.publicKey(), transaction.source_account);
  expect('relayer-pays-fee', transaction.fee_account === relayer.publicKey(), transaction.fee_account);
  expect('customer-is-not-source', transaction.source_account !== customer.publicKey());
  expect('customer-pays-amount-only', Math.abs(customerDelta - Number(amount)) < 1e-7, {customerDelta, amount});
  // Soroban resource fees are larger than a classic base fee; the point is that
  // the relayer pays a fee and never the payment amount.
  expect('relayer-pays-fee-not-amount', relayerDelta > 0 && relayerDelta < Number(amount), {relayerDelta});
  expect('recipient-received-amount', Math.abs(recipientDelta - Number(amount)) < 1e-7, {recipientDelta});

  const evidence = {
    network: 'testnet',
    contractId: deployment.settlementContractId,
    customer: customer.publicKey(),
    relayer: relayer.publicKey(),
    recipient,
    merchantProfileId,
    merchantSigningKey,
    amount,
    transactionHash: receipt.transactionHash,
    ledger: receipt.ledger,
    feeAccount: transaction.fee_account,
    sourceAccount: transaction.source_account,
    feeCharged: transaction.fee_charged,
    customerDelta,
    recipientDelta,
    settledAt: new Date().toISOString(),
    checks,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
}

async function latestLedger(rpcUrl: string): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getLatestLedger'}),
  });
  const body = await response.json() as {result?: {sequence?: number}};
  const sequence = body.result?.sequence;
  if (!sequence) throw new Error('Could not read the latest Testnet ledger');
  return sequence;
}

async function balances(horizon: Horizon.Server, customer: string, relayer: string, recipient: string) {
  const read = async (address: string) => {
    const account = await horizon.loadAccount(address);
    return account.balances.find(balance => balance.asset_type === 'native')?.balance ?? '0';
  };
  return {customer: await read(customer), relayer: await read(relayer), recipient: await read(recipient)};
}

await main();
