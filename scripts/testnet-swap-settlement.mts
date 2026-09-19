/**
 * Proves the Soroswap funding path on Testnet, end to end, with nothing mocked.
 *
 * The scenario is the one the backlog has carried as unsolvable since the lira
 * work landed: a merchant prices in USDC, and the customer holds only XLM. The
 * settlement contract moves one named token, so before this the payment simply
 * could not happen.
 *
 * What this run demonstrates on-chain, in a single transaction:
 *
 *   - the customer is the production smart wallet, a contract account whose
 *     only signer is a P-256 key, and it starts with a zero USDC balance;
 *   - one device signature authorizes the whole tree: the settlement call, the
 *     Soroswap swap underneath it, and the token transfer underneath that;
 *   - the relayer is the transaction source and pays the fee, as always;
 *   - the merchant receives exactly the USDC amount they signed for, and the
 *     merchant's signature never mentions Soroswap, a path, or a price;
 *   - the customer's USDC balance is zero before and zero after, because the
 *     swap buys the payment rather than a balance.
 *
 * Run: npm run testnet:swap
 */
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {Buffer} from 'node:buffer';
import {p256} from '@noble/curves/nist.js';
import {getPublicKey, hashes, sign} from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha2.js';
import {
  Contract,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {basicNodeSigner} from '@stellar/stellar-sdk/contract';
import {createPaymentIntent, hashPaymentIntent, type PaymentAsset} from '@rosapay/protocol';
import {
  buildSettlementEnvelope,
  createSettlementClient,
  createStellarConfig,
  quoteSwapFunding,
  settleSignedPayment,
} from '@rosapay/stellar';

hashes.sha512 = sha512;

const deployment = JSON.parse(readFileSync('config/testnet-deployment.json', 'utf8'));
const walletDeployment = JSON.parse(readFileSync('config/testnet-wallet-deployment.json', 'utf8'));
const configDir = process.env.ROSAPAY_STELLAR_CONFIG_DIR ?? `${process.env.HOME ?? ''}/.config/stellar`;
const adminIdentity = process.env.ROSAPAY_ADMIN_IDENTITY ?? 'rosapay-testnet-deployer';
const relayerIdentity = process.env.ROSAPAY_RELAYER_IDENTITY ?? 'rosapay-testnet-relayer';
const deviceKeyPath = process.env.ROSAPAY_WALLET_DEVICE_KEY ?? '.stellar/wallet-device-key.json';
const evidencePath = process.env.ROSAPAY_SWAP_EVIDENCE ?? 'config/testnet-swap-evidence.json';

/** What the merchant asks to be paid, and what the customer actually holds. */
const amount = '0.1';
const usdc = deployment.registeredAssets.find((asset: {code: string}) => asset.code === 'USDC');
if (!usdc) throw new Error('The deployment manifest has no registered USDC asset');
const usdcAsset: PaymentAsset = {type: 'credit', code: 'USDC', issuer: usdc.issuer, decimals: 7};
const usdcContractId: string = usdc.contractId;
const xlmContractId: string = deployment.nativeAssetContractId;
const routerContractId: string = deployment.swap.routerContractId;

function secretOf(identity: string, envVar?: string): string {
  const fromEnv = envVar ? process.env[envVar]?.trim() : undefined;
  if (fromEnv) {
    if (!/^S[A-Z2-7]{55}$/.test(fromEnv)) throw new Error(`${envVar} is not a Stellar secret key`);
    return fromEnv;
  }
  const result = spawnSync('stellar', ['keys', 'show', identity, '--config-dir', configDir], {encoding: 'utf8'});
  const secret = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    .split('\n')
    .map(line => line.trim())
    .find(line => /^S[A-Z2-7]{55}$/.test(line));
  if (!secret) throw new Error(`Could not read the secret key for ${identity}`);
  return secret;
}

/**
 * The wallet verifies a signature over the authorization payload itself rather
 * than a hash of it, and Soroban accepts only low-S signatures.
 */
function signPayload(secretKey: Uint8Array, payload: Buffer): Buffer {
  const signature = p256.sign(Uint8Array.from(payload), secretKey, {prehash: false, lowS: true});
  const bytes = signature instanceof Uint8Array ? signature : signature.toBytes('compact');
  if (bytes.length !== 64) throw new Error('Expected a 64-byte P-256 signature');
  return Buffer.from(bytes);
}

function walletSignature(publicKey: Buffer, signature: Buffer): xdr.ScVal {
  // `WalletSignature::Device`, an enum variant carrying the ordered struct.
  return xdr.ScVal.scvVec([
    nativeToScVal('Device', {type: 'symbol'}),
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({key: nativeToScVal('public_key', {type: 'symbol'}), val: xdr.ScVal.scvBytes(publicKey)}),
      new xdr.ScMapEntry({key: nativeToScVal('signature', {type: 'symbol'}), val: xdr.ScVal.scvBytes(signature)}),
    ]),
  ]);
}

/** Reads a SAC balance for any address, contract or classic. */
async function tokenBalance(server: rpc.Server, tokenId: string, holder: string, source: string): Promise<bigint> {
  const built = new TransactionBuilder(await server.getAccount(source), {
    fee: '100000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(tokenId).call('balance', nativeToScVal(holder, {type: 'address'})))
    .setTimeout(30)
    .build();
  const simulation = await server.simulateTransaction(built);
  if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
    throw new Error(`Could not read the balance of ${tokenId} for ${holder}`);
  }
  return BigInt(scValToNative(simulation.result.retval));
}

async function latestLedger(rpcUrl: string): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getLatestLedger'}),
  });
  const body = (await response.json()) as {result?: {sequence?: number}};
  const sequence = body.result?.sequence;
  if (!sequence) throw new Error('Could not read the latest Testnet ledger');
  return sequence;
}

async function main() {
  const admin = Keypair.fromSecret(secretOf(adminIdentity, 'STELLAR_ADMIN_SECRET'));
  const relayer = Keypair.fromSecret(secretOf(relayerIdentity, 'STELLAR_RELAYER_SECRET'));
  const customer: string = walletDeployment.walletContractId;
  const recipient = admin.publicKey();
  const devicePublicKey = Buffer.from(walletDeployment.devicePublicKey, 'hex');
  const deviceKey = Uint8Array.from(
    Buffer.from(JSON.parse(readFileSync(deviceKeyPath, 'utf8')).privateKeyHex, 'hex'),
  );

  const config = createStellarConfig('testnet', {
    rpcUrl: deployment.rpcUrl,
    settlementContractId: deployment.settlementContractId,
  });
  const server = new rpc.Server(config.rpcUrl);

  const checks: string[] = [];
  const expect = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) throw new Error(`${label} failed: ${JSON.stringify(detail, bigintReplacer)}`);
    checks.push(label);
  };

  // The contract must already be pointed at the router; a run against a
  // contract that is not would otherwise fail deep inside a simulation.
  const routerReader = createSettlementClient(config, {publicKey: relayer.publicKey()});
  const onChainRouter = (await routerReader.swap_router({simulate: true})).result;
  expect('contract-knows-router', onChainRouter === routerContractId, {onChainRouter, routerContractId});

  const before = {
    customerXlm: await tokenBalance(server, xlmContractId, customer, relayer.publicKey()),
    customerUsdc: await tokenBalance(server, usdcContractId, customer, relayer.publicKey()),
    recipientUsdc: await tokenBalance(server, usdcContractId, recipient, relayer.publicKey()),
  };
  // The whole point of the run: the customer cannot pay this bill directly.
  expect('customer-holds-no-usdc', before.customerUsdc === 0n, before.customerUsdc);
  expect('customer-holds-xlm', before.customerXlm > 0n, before.customerXlm);

  // A fresh merchant per run, registered on-chain by the contract admin.
  const merchantSecret = Keypair.random().rawSecretKey();
  const merchantSigningKey = StrKey.encodeEd25519PublicKey(Buffer.from(await getPublicKey(merchantSecret)));
  const merchantProfileId = crypto.randomUUID();

  const intent = createPaymentIntent({
    profile: {merchantProfileId, merchantName: 'Rose Coffee', merchantSigningKey, recipient, network: 'testnet'},
    asset: usdcAsset,
    amount,
    reference: 'Soroswap-funded settlement proof',
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
    customer,
    networkPassphrase: config.networkPassphrase,
    settlementContractId: deployment.settlementContractId,
  });
  expect('intent-names-usdc', envelope.intent.token === usdcContractId, envelope.intent.token);

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
  await registration.signAndSend({signTransaction: adminSigner.signTransaction});

  // Soroswap prices the payment in the money the customer actually has. This is
  // the same call the confirmation screen makes before anyone is asked to
  // approve anything.
  const path = [xlmContractId, usdcContractId];
  const quote = await quoteSwapFunding({
    config,
    routerContractId,
    path,
    settlementToken: envelope.intent.token,
    amountOut: envelope.intent.amount,
  });
  expect('quote-is-priced', quote.amountIn > 0n, quote.amountIn);
  expect('ceiling-is-above-quote', quote.amountInMax > quote.amountIn, quote);
  expect('customer-can-afford-quote', before.customerXlm > quote.amountInMax, {
    held: before.customerXlm,
    needed: quote.amountInMax,
  });

  const digestClient = createSettlementClient(config, {publicKey: relayer.publicKey()});
  const digest = (await digestClient.intent_digest({intent: envelope.intent}, {simulate: true})).result;
  const merchantContractSignature = await sign(Buffer.from(digest), merchantSecret);

  const relayerSigner = basicNodeSigner(relayer, config.networkPassphrase);
  const stages: string[] = [];
  const receipt = await settleSignedPayment({
    payload,
    config,
    customerAddress: customer,
    relayerAddress: relayer.publicKey(),
    latestLedger: await latestLedger(config.rpcUrl),
    merchantContractSignature,
    // One device signature covers the settlement call, the Soroswap swap
    // underneath it, and the transfers underneath that.
    customerAuthorizeEntry: (entry, _signer, validUntilLedger, networkPassphrase) =>
      authorizeEntry(
        entry,
        async (_preimage, authPayload) => ({
          signatureScVal: walletSignature(devicePublicKey, signPayload(deviceKey, Buffer.from(authPayload))),
        }),
        validUntilLedger,
        networkPassphrase ?? config.networkPassphrase,
      ),
    relayerSigner: {signTransaction: relayerSigner.signTransaction},
    funding: {
      path,
      amountInMax: quote.amountInMax,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
    },
    onProgress: progress => stages.push(progress.stage),
  });

  const after = {
    customerXlm: await tokenBalance(server, xlmContractId, customer, relayer.publicKey()),
    customerUsdc: await tokenBalance(server, usdcContractId, customer, relayer.publicKey()),
    recipientUsdc: await tokenBalance(server, usdcContractId, recipient, relayer.publicKey()),
  };
  const spentXlm = before.customerXlm - after.customerXlm;
  const receivedUsdc = after.recipientUsdc - before.recipientUsdc;

  const confirmed = await server.getTransaction(receipt.transactionHash);
  if (confirmed.status !== 'SUCCESS') throw new Error(`Settlement did not confirm: ${confirmed.status}`);
  const events = readContractEvents(confirmed);

  expect('pipeline-stages', ['simulated', 'authorized', 'submitted', 'confirmed'].every(s => stages.includes(s)), stages);
  expect('merchant-received-exact-amount', receivedUsdc === envelope.intent.amount, {
    receivedUsdc,
    signedFor: envelope.intent.amount,
  });
  expect('customer-keeps-no-usdc', after.customerUsdc === 0n, after.customerUsdc);
  expect('customer-spent-xlm', spentXlm > 0n, spentXlm);
  expect('spend-within-signed-ceiling', spentXlm <= quote.amountInMax, {spentXlm, ceiling: quote.amountInMax});
  const source = transactionSource(confirmed);
  expect('relayer-is-source-and-fee-payer', source === relayer.publicKey(), {source, relayer: relayer.publicKey()});
  expect('customer-is-not-source', source !== customer, source);
  expect(
    'soroswap-router-in-the-transaction',
    events.some(event => event.contract === routerContractId),
    events.map(event => event.contract),
  );
  expect(
    'contract-reported-funding',
    events.some(
      event => event.contract === deployment.settlementContractId && event.topics.includes('payment_funded'),
    ),
    events,
  );
  expect(
    'contract-reported-settlement',
    events.some(
      event => event.contract === deployment.settlementContractId && event.topics.includes('payment_settled'),
    ),
    events,
  );

  const evidence = {
    network: 'testnet',
    contractId: deployment.settlementContractId,
    swapProtocol: 'Soroswap',
    routerContractId,
    customer,
    customerKind: 'smart wallet (P-256 device signer)',
    relayer: relayer.publicKey(),
    recipient,
    merchantProfileId,
    merchantSigningKey,
    merchantAskedFor: {asset: 'USDC', amount, contractId: usdcContractId},
    customerPaidWith: {asset: 'XLM', contractId: xlmContractId},
    path,
    quotedAmountIn: quote.amountIn.toString(),
    signedCeiling: quote.amountInMax.toString(),
    slippageBps: quote.slippageBps,
    actualXlmSpent: spentXlm.toString(),
    usdcDeliveredToMerchant: receivedUsdc.toString(),
    customerUsdcBefore: before.customerUsdc.toString(),
    customerUsdcAfter: after.customerUsdc.toString(),
    effectiveRate: `${(Number(spentXlm) / Number(receivedUsdc)).toFixed(7)} XLM per USDC`,
    transactionHash: receipt.transactionHash,
    ledger: receipt.ledger,
    settledAt: new Date().toISOString(),
    checks,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
}

type DecodedEvent = {contract: string; topics: string[]};

/**
 * The one place the whole claim can be checked: which contracts this single
 * transaction actually touched, and in what order. Soroswap's router and pair
 * appear in it because the swap is a sub-invocation of the settlement call, not
 * a separate transaction someone could have submitted alongside it.
 */
function readContractEvents(confirmed: rpc.Api.GetSuccessfulTransactionResponse): DecodedEvent[] {
  const groups = (confirmed as unknown as {events?: {contractEventsXdr?: unknown[]}}).events?.contractEventsXdr ?? [];
  const decoded: DecodedEvent[] = [];
  for (const group of groups) {
    for (const raw of Array.isArray(group) ? group : [group]) {
      const event = typeof raw === 'string' ? xdr.ContractEvent.fromXDR(raw, 'base64') : (raw as xdr.ContractEvent);
      // Depending on the SDK build this is either raw bytes or an XDR Hash.
      const contractId = event.contractId() as unknown as {toXDR?(): Buffer} | Buffer | undefined;
      const contractBytes = contractId
        ? Buffer.from(typeof (contractId as {toXDR?(): Buffer}).toXDR === 'function'
            ? (contractId as {toXDR(): Buffer}).toXDR()
            : (contractId as Buffer))
        : undefined;
      decoded.push({
        contract: contractBytes ? StrKey.encodeContract(contractBytes) : '',
        // Topics carry addresses and 32-byte ids as well as symbols; anything
        // that is not readable text is not something this script asserts on.
        topics: event.body().v0().topics().map(topic => safeTopic(topic)),
      });
    }
  }
  return decoded;
}

function transactionSource(confirmed: rpc.Api.GetSuccessfulTransactionResponse): string {
  const envelope = confirmed.envelopeXdr;
  const account = envelope.switch() === xdr.EnvelopeType.envelopeTypeTxFeeBump()
    ? envelope.feeBump().tx().feeSource()
    : envelope.v1().tx().sourceAccount();
  return StrKey.encodeEd25519PublicKey(account.ed25519());
}

function safeTopic(topic: xdr.ScVal): string {
  try {
    const value = scValToNative(topic);
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

await main();
