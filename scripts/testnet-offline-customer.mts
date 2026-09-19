/**
 * Proves the plan's central claim: the customer never touches the network.
 *
 * The merchant is online. It simulates the settlement, pulls out the one
 * authorization entry the customer has to sign, and hands it over — that is the
 * payload a tap or a code would carry. The customer half of this script runs
 * with `fetch` taken away from it, so if it reached for the network at all it
 * would fail rather than quietly succeed. It verifies the invocation against the
 * intent on its screen, signs with its device key, and hands back an
 * authorization the merchant submits through the relayer.
 */
import {randomUUID, getRandomValues} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Buffer} from 'node:buffer';
import {getPublicKey, hashes, sign} from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha2.js';
import {p256} from '@noble/curves/nist.js';
import {Horizon, Keypair, StrKey, xdr} from '@stellar/stellar-sdk';
import {basicNodeSigner} from '@stellar/stellar-sdk/contract';
import {createPaymentIntent, hashPaymentIntent} from '@rosapay/protocol';
import {
  authorizeOffline,
  buildSettlementEnvelope,
  createSettlementClient,
  createStellarConfig,
  prepareAuthorizationRequest,
  readNativeBalance,
  type PaymentAuthorization,
  type UnsignedAuthRequest,
} from '@rosapay/stellar';
import {Asset, Contract, TransactionBuilder, BASE_FEE, rpc} from '@stellar/stellar-sdk';

hashes.sha512 = sha512;

const deployment = JSON.parse(readFileSync('config/testnet-deployment.json', 'utf8'));
const walletDeployment = JSON.parse(readFileSync('config/testnet-wallet-deployment.json', 'utf8'));
const deviceKey = JSON.parse(readFileSync(process.env.ROSAPAY_WALLET_DEVICE_KEY ?? '.stellar/wallet-device-key.json', 'utf8'));
const pair = JSON.parse(readFileSync('config/testnet-demo-pair.json', 'utf8'));
const amount = process.env.ROSAPAY_DEMO_AMOUNT ?? '0.4';

function toDer(compact: Uint8Array): Uint8Array {
  const encodeInteger = (value: Uint8Array) => {
    let bytes = value;
    while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
    const padded = (bytes[0] ?? 0) & 0x80 ? Uint8Array.from([0, ...bytes]) : bytes;
    return Uint8Array.from([0x02, padded.length, ...padded]);
  };
  const body = Uint8Array.from([
    ...encodeInteger(compact.subarray(0, 32)),
    ...encodeInteger(compact.subarray(32)),
  ]);
  return Uint8Array.from([0x30, body.length, ...body]);
}

/** Stands in for the Secure Enclave / Keystore key on the customer's phone. */
function deviceSigner() {
  const secretKey = Uint8Array.from(Buffer.from(deviceKey.privateKeyHex, 'hex'));
  return {
    publicKey: Buffer.from(p256.getPublicKey(secretKey, false)).toString('base64'),
    signDigest: async ({digest}: {digest: string}) => {
      const signature = p256.sign(Uint8Array.from(Buffer.from(digest, 'base64')), secretKey, {
        prehash: false,
        lowS: true,
      });
      return {signature: Buffer.from(toDer(signature)).toString('base64')};
    },
  };
}

async function latestLedger(rpcUrl: string): Promise<number> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'getLatestLedger'}),
  });
  return (await response.json()).result.sequence as number;
}

/**
 * Runs the customer's half with no way to reach the network, so "offline" is
 * enforced rather than asserted.
 */
async function withoutNetwork<T>(work: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error('The customer reached for the network while authorizing');
  }) as typeof fetch;
  try {
    return await work();
  } finally {
    globalThis.fetch = realFetch;
  }
}

/**
 * Tops the wallet up so the payment is about authorization rather than about
 * balance. A wallet with nothing in it makes the simulation produce no
 * authorization entry at all, which looks like the offline path being broken.
 */
async function ensureWalletFunded(
  config: ReturnType<typeof createStellarConfig>,
  walletContractId: string,
  relayer: Keypair,
  needed: number,
): Promise<void> {
  const balance = Number(await readNativeBalance(config, walletContractId).catch(() => '0'));
  if (balance >= needed) return;

  console.log(`merchant  wallet holds ${balance} XLM; topping it up from the relayer`);
  const server = new rpc.Server(config.rpcUrl);
  const account = await server.getAccount(relayer.publicKey());
  const sac = new Contract(Asset.native().contractId(config.networkPassphrase));
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      sac.call(
        'transfer',
        new (await import('@stellar/stellar-sdk')).Address(relayer.publicKey()).toScVal(),
        new (await import('@stellar/stellar-sdk')).Address(walletContractId).toScVal(),
        (await import('@stellar/stellar-sdk')).nativeToScVal(BigInt(Math.round(needed * 10 * 1e7)), {type: 'i128'}),
      ),
    )
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(transaction);
  prepared.sign(relayer);
  const sent = await server.sendTransaction(prepared);
  const result = await server.pollTransaction(sent.hash);
  if (result.status !== 'SUCCESS') throw new Error(`Could not fund the wallet: ${result.status}`);
}

async function main() {
  const config = createStellarConfig('testnet', {
    rpcUrl: deployment.rpcUrl,
    settlementContractId: deployment.settlementContractId,
  });
  const horizon = new Horizon.Server(config.horizonUrl);
  const relayer = Keypair.fromSecret(process.env.STELLAR_RELAYER_SECRET!.trim());
  const admin = Keypair.fromSecret(process.env.STELLAR_ADMIN_SECRET!.trim());
  const walletContractId = walletDeployment.walletContractId as string;

  const merchantSigningSecret = Uint8Array.from(Buffer.from(pair.merchantSigningSecretHex, 'hex'));
  const merchantSigningKey = StrKey.encodeEd25519PublicKey(Buffer.from(await getPublicKey(merchantSigningSecret)));

  // ---- merchant, online ---------------------------------------------------
  const intent = createPaymentIntent({
    profile: {
      merchantProfileId: pair.merchantProfileId,
      merchantName: pair.merchantName,
      merchantSigningKey,
      recipient: pair.merchantRecipient,
      network: 'testnet',
    },
    amount,
    reference: 'Offline customer proof',
    latestLedger: await latestLedger(config.rpcUrl),
    intentId: randomUUID(),
    nonce: Buffer.from(getRandomValues(new Uint8Array(16))).toString('hex'),
    createdAt: new Date().toISOString(),
  });
  const payload = {
    intent,
    signature: Buffer.from(await sign(Buffer.from(hashPaymentIntent(intent), 'hex'), merchantSigningSecret)).toString('base64'),
  };

  const envelope = buildSettlementEnvelope(intent, {
    customer: walletContractId,
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
    recipient: pair.merchantRecipient,
  });
  await registration.signAndSend({signTransaction: adminSigner.signTransaction});

  await ensureWalletFunded(config, walletContractId, relayer, Number(amount));

  const digestClient = createSettlementClient(config, {publicKey: relayer.publicKey()});
  const digest = (await digestClient.intent_digest({intent: envelope.intent}, {simulate: true})).result;
  const merchantSignature = await sign(Buffer.from(digest), merchantSigningSecret);

  const relayerSigner = basicNodeSigner(relayer, config.networkPassphrase);
  const client = createSettlementClient(config, {
    publicKey: relayer.publicKey(),
    signTransaction: relayerSigner.signTransaction,
  });
  const transaction = await client.settle_payment(
    {intent: envelope.intent, merchant_signature: Buffer.from(merchantSignature)},
    {simulate: true},
  );

  const signatureExpirationLedger = (await latestLedger(config.rpcUrl)) + 120;
  const request: UnsignedAuthRequest = prepareAuthorizationRequest({
    transaction,
    customerAddress: walletContractId,
    networkPassphrase: config.networkPassphrase,
    settlementContractId: deployment.settlementContractId,
    signatureExpirationLedger,
  });
  console.log(`merchant  prepared an authorization request (${request.entryXdr.length} base64 chars to carry)`);

  // ---- customer, with the network taken away ------------------------------
  const authorization: PaymentAuthorization = await withoutNetwork(() =>
    authorizeOffline({
      request,
      intent,
      customerAddress: walletContractId,
      signer: deviceSigner(),
      reason: `Approve ${amount} XLM to ${intent.merchantName}`,
    }),
  );
  console.log('customer  verified and signed it with no network at all');

  // ---- merchant, online: submit -------------------------------------------
  const before = Number((await horizon.loadAccount(pair.merchantRecipient)).balances.find(b => b.asset_type === 'native')!.balance);

  const signedEntry = xdr.SorobanAuthorizationEntry.fromXDR(authorization.entryXdr, 'base64');
  await transaction.signAuthEntries({
    address: walletContractId,
    authorizeEntry: async () => signedEntry,
  } as never);
  // A contract account only reads its signer during `__check_auth`, which the
  // first simulation never ran; re-simulating puts that read in the footprint.
  await transaction.simulate?.({restore: true});

  const sent = await transaction.signAndSend({signTransaction: relayerSigner.signTransaction});
  const confirmation = sent.getTransactionResponse;
  if (!confirmation || confirmation.status !== 'SUCCESS') {
    throw new Error(`Settlement failed: ${confirmation?.status ?? 'no response'}`);
  }

  const after = Number((await horizon.loadAccount(pair.merchantRecipient)).balances.find(b => b.asset_type === 'native')!.balance);
  const received = Math.round((after - before) * 1e7) / 1e7;
  if (Math.abs(received - Number(amount)) > 1e-7) {
    throw new Error(`Merchant received ${received}, expected ${amount}`);
  }

  console.log(`merchant  submitted it; the relayer paid the fee\n`);
  console.log(`Wallet ${walletContractId} paid ${amount} XLM without ever connecting.`);
  console.log(`  tx     ${confirmation.txHash}`);
  console.log(`  ledger ${confirmation.ledger}`);
  console.log(`  https://stellar.expert/explorer/testnet/tx/${confirmation.txHash}`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
