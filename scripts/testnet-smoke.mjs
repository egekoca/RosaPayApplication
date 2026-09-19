import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';

import {getPublicKey, hashes, sign, utils} from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha2.js';
import {hash, Networks} from '@stellar/stellar-sdk';

hashes.sha512 = sha512;

const deployment = JSON.parse(readFileSync('config/testnet-deployment.json', 'utf8'));
// Stellar CLI 27 no longer discovers repository-local config implicitly.
// Match its documented global default while preserving an explicit override.
const configDir = process.env.ROSAPAY_STELLAR_CONFIG_DIR ?? `${homedir()}/.config/stellar`;
const adminIdentity = process.env.ROSAPAY_ADMIN_IDENTITY ?? 'rosapay-testnet-deployer';
const customerIdentity = process.env.ROSAPAY_CUSTOMER_IDENTITY ?? 'rosapay-testnet-customer';
const evidencePath = process.env.ROSAPAY_SMOKE_EVIDENCE ?? 'config/testnet-smoke-evidence.json';
const amount = 1_000_000n;

function runStellar(args, {allowFailure = false} = {}) {
  const result = spawnSync('stellar', args, {encoding: 'utf8'});
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`Stellar CLI failed: ${output.trim()}`);
  }
  return {status: result.status ?? 1, stdout: result.stdout?.trim() ?? '', output};
}

function publicKey(identity) {
  return runStellar(['keys', 'public-key', identity, '--config-dir', configDir]).stdout;
}

function invoke(source, functionName, args, {allowFailure = false, send = 'default'} = {}) {
  return runStellar([
    'contract',
    'invoke',
    '--config-dir',
    configDir,
    '--id',
    deployment.settlementContractId,
    '--source-account',
    source,
    '--rpc-url',
    deployment.rpcUrl,
    '--network-passphrase',
    deployment.networkPassphrase,
    `--send=${send}`,
    '--',
    functionName,
    ...args,
  ], {allowFailure});
}

async function latestLedger() {
  const response = await fetch(deployment.rpcUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getHealth'}),
  });
  if (!response.ok) throw new Error(`RPC health failed with HTTP ${response.status}`);
  const body = await response.json();
  if (body.result?.status !== 'healthy') throw new Error('Testnet RPC is not healthy');
  return Number(body.result.latestLedger);
}

async function xlmBalance(address) {
  const response = await fetch(`${deployment.horizonUrl}/accounts/${address}`);
  if (!response.ok) throw new Error(`Horizon account lookup failed with HTTP ${response.status}`);
  const account = await response.json();
  const native = account.balances.find(balance => balance.asset_type === 'native');
  if (!native) throw new Error(`No native XLM balance found for ${address}`);
  const [whole, fraction = ''] = native.balance.split('.');
  return BigInt(whole) * 10_000_000n + BigInt(fraction.padEnd(7, '0').slice(0, 7));
}

async function confirmedTransaction(transactionHash) {
  const response = await fetch(`${deployment.horizonUrl}/transactions/${transactionHash}`);
  if (!response.ok) throw new Error(`Horizon transaction lookup failed with HTTP ${response.status}`);
  const transaction = await response.json();
  if (!transaction.successful) throw new Error(`Transaction ${transactionHash} is not successful`);
  return transaction;
}

function randomHex(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

function contractIntent({customer, recipient, merchantId, ledger, overrides = {}}) {
  return {
    amount: amount.toString(),
    customer,
    expires_at_ledger: ledger + 120,
    intent_id: randomHex(),
    merchant_id: merchantId,
    network_id: hash(Buffer.from(Networks.TESTNET)).toString('hex'),
    nonce: randomHex(),
    recipient,
    settlement_contract: deployment.settlementContractId,
    token: deployment.nativeAssetContractId,
    ...overrides,
  };
}

function intentDigest(intent) {
  const result = invoke(adminIdentity, 'intent_digest', ['--intent', JSON.stringify(intent)], {send: 'no'});
  const digest = result.stdout.match(/[a-f0-9]{64}/i)?.[0];
  if (!digest) throw new Error(`Could not parse contract intent digest: ${result.stdout}`);
  return digest.toLowerCase();
}

function assertContractFailure(result, code, label) {
  if (result.status === 0 || !result.output.includes(`Error(Contract, #${code})`)) {
    throw new Error(`${label} did not fail with contract error ${code}: ${result.output.trim()}`);
  }
}

function isConsumed(intentId) {
  return invoke(adminIdentity, 'is_intent_consumed', ['--intent_id', intentId], {send: 'no'}).stdout === 'true';
}

const admin = publicKey(adminIdentity);
const customer = publicKey(customerIdentity);
const merchantSecret = utils.randomSecretKey();

try {
  let evidence = existsSync(evidencePath)
    ? JSON.parse(readFileSync(evidencePath, 'utf8'))
    : null;
  if (evidence && (
    evidence.contractId !== deployment.settlementContractId ||
    evidence.customer !== customer ||
    evidence.recipient !== admin ||
    evidence.amountStroops !== amount.toString()
  )) {
    throw new Error('Existing smoke evidence does not match the active deployment or identities');
  }

  const merchantKey = Buffer.from(getPublicKey(merchantSecret)).toString('hex');
  const merchantId = randomHex();
  const ledger = await latestLedger();

  const registration = invoke(adminIdentity, 'register_merchant', [
    '--merchant_id',
    merchantId,
    '--signing_key',
    merchantKey,
    '--recipient',
    admin,
  ]);
  const negativeMerchantRegistrationHash = registration.output.match(/testnet\/tx\/([a-f0-9]{64})/i)?.[1] ?? null;

  if (!evidence) {
    const intent = contractIntent({customer, recipient: admin, merchantId, ledger});
    const digest = intentDigest(intent);
    const signature = Buffer.from(sign(Buffer.from(digest, 'hex'), merchantSecret)).toString('hex');
    const recipientBefore = await xlmBalance(admin);
    const customerBefore = await xlmBalance(customer);

    const settlement = invoke(customerIdentity, 'settle_payment', [
      '--intent',
      JSON.stringify(intent),
      '--merchant_signature',
      signature,
    ]);
    const settlementHash = settlement.output.match(/testnet\/tx\/([a-f0-9]{64})/i)?.[1];
    if (!settlementHash) throw new Error('Settlement transaction hash was not reported by Stellar CLI');
    if (!isConsumed(intent.intent_id)) throw new Error('Settled intent was not recorded as consumed');

    const recipientAfter = await xlmBalance(admin);
    const customerAfter = await xlmBalance(customer);
    if (recipientAfter - recipientBefore !== amount) {
      throw new Error(`Recipient XLM delta was ${recipientAfter - recipientBefore}, expected ${amount}`);
    }
    if (customerBefore - customerAfter < amount) {
      throw new Error('Customer balance did not decrease by the settlement amount');
    }

    evidence = {
      network: deployment.network,
      contractId: deployment.settlementContractId,
      customer,
      recipient: admin,
      amountStroops: amount.toString(),
      registrationTransactionHash: negativeMerchantRegistrationHash,
      settlementTransactionHash: settlementHash,
      intent,
      merchantSignature: signature,
    };
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {flag: 'wx'});
  }

  if (!isConsumed(evidence.intent.intent_id)) {
    throw new Error('Recorded settlement intent is not consumed on the active contract');
  }
  const settlementTransaction = await confirmedTransaction(evidence.settlementTransactionHash);
  if (settlementTransaction.source_account !== customer) {
    throw new Error('Recorded settlement transaction was not submitted by the configured customer');
  }

  let replayCheck = 'replay-consumed-state';
  if (ledger < evidence.intent.expires_at_ledger) {
    assertContractFailure(
      invoke(customerIdentity, 'settle_payment', [
        '--intent',
        JSON.stringify(evidence.intent),
        '--merchant_signature',
        evidence.merchantSignature,
      ], {allowFailure: true}),
      7,
      'Replay',
    );
    replayCheck = 'replay';
  }

  const signedBeforeMutation = contractIntent({customer, recipient: admin, merchantId, ledger});
  const mutationDigest = intentDigest(signedBeforeMutation);
  const mutationSignature = Buffer.from(
    sign(Buffer.from(mutationDigest, 'hex'), merchantSecret),
  ).toString('hex');
  const amountMutation = {...signedBeforeMutation, amount: (amount + 1n).toString()};
  const mutationResult = invoke(customerIdentity, 'settle_payment', [
    '--intent',
    JSON.stringify(amountMutation),
    '--merchant_signature',
    mutationSignature,
  ], {allowFailure: true});
  if (mutationResult.status === 0 || isConsumed(amountMutation.intent_id)) {
    throw new Error('Amount mutation was not rejected before consuming the intent');
  }

  const zeroSignature = '00'.repeat(64);
  const expired = contractIntent({
    customer,
    recipient: admin,
    merchantId,
    ledger,
    overrides: {expires_at_ledger: ledger},
  });
  assertContractFailure(
    invoke(customerIdentity, 'settle_payment', [
      '--intent', JSON.stringify(expired), '--merchant_signature', zeroSignature,
    ], {allowFailure: true}),
    6,
    'Expired intent',
  );

  const wrongRecipient = contractIntent({
    customer,
    recipient: customer,
    merchantId,
    ledger,
  });
  assertContractFailure(
    invoke(customerIdentity, 'settle_payment', [
      '--intent', JSON.stringify(wrongRecipient), '--merchant_signature', zeroSignature,
    ], {allowFailure: true}),
    3,
    'Recipient mutation',
  );

  const unsupportedAsset = contractIntent({
    customer,
    recipient: admin,
    merchantId,
    ledger,
    overrides: {token: deployment.settlementContractId},
  });
  assertContractFailure(
    invoke(customerIdentity, 'settle_payment', [
      '--intent', JSON.stringify(unsupportedAsset), '--merchant_signature', zeroSignature,
    ], {allowFailure: true}),
    4,
    'Asset mutation',
  );

  const invalidAmount = contractIntent({
    customer,
    recipient: admin,
    merchantId,
    ledger,
    overrides: {amount: '0'},
  });
  assertContractFailure(
    invoke(customerIdentity, 'settle_payment', [
      '--intent', JSON.stringify(invalidAmount), '--merchant_signature', zeroSignature,
    ], {allowFailure: true}),
    5,
    'Invalid amount',
  );

  const wrongNetwork = contractIntent({
    customer,
    recipient: admin,
    merchantId,
    ledger,
    overrides: {network_id: '00'.repeat(32)},
  });
  assertContractFailure(
    invoke(customerIdentity, 'settle_payment', [
      '--intent', JSON.stringify(wrongNetwork), '--merchant_signature', zeroSignature,
    ], {allowFailure: true}),
    8,
    'Wrong network',
  );

  const wrongContract = contractIntent({
    customer,
    recipient: admin,
    merchantId,
    ledger,
    overrides: {settlement_contract: deployment.nativeAssetContractId},
  });
  assertContractFailure(
    invoke(customerIdentity, 'settle_payment', [
      '--intent', JSON.stringify(wrongContract), '--merchant_signature', zeroSignature,
    ], {allowFailure: true}),
    9,
    'Wrong contract',
  );

  const fakeMerchant = contractIntent({
    customer,
    recipient: admin,
    merchantId: randomHex(),
    ledger,
  });
  assertContractFailure(
    invoke(customerIdentity, 'settle_payment', [
      '--intent', JSON.stringify(fakeMerchant), '--merchant_signature', zeroSignature,
    ], {allowFailure: true}),
    1,
    'Fake merchant',
  );

  console.log(JSON.stringify({
    network: deployment.network,
    contractId: deployment.settlementContractId,
    customer,
    recipient: admin,
    amountStroops: amount.toString(),
    negativeMerchantRegistrationHash,
    settlementTransactionHash: evidence.settlementTransactionHash,
    intentId: evidence.intent.intent_id,
    checks: [
      'settled',
      'balance-transfer',
      'consumed',
      replayCheck,
      'amount-tamper',
      'expiry',
      'recipient',
      'asset',
      'invalid-amount',
      'wrong-network',
      'wrong-contract',
      'fake-merchant',
    ],
  }, null, 2));
} finally {
  merchantSecret.fill(0);
}
