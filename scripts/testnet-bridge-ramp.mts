/**
 * Proves that a smart-wallet customer can use the lira ramp, both ways.
 *
 * The anchor cannot see a contract account at all: it authenticates accounts,
 * refuses a contract address as a deposit destination, and matches withdrawals
 * from a payments stream that a contract transfer never appears in. So the app
 * carries a bridge - a classic account that holds nothing at rest and exists to
 * stand where the anchor can see it.
 *
 * This run is the whole claim, end to end, against the live anchor:
 *
 *   in    anchor ──payment──▶ bridge (G) ──SAC transfer──▶ smart wallet (C)
 *   out   smart wallet (C) ──SAC transfer──▶ bridge (G) ──payment+memo──▶ anchor
 *
 * It calls the app's own `anchorBridge` module rather than reimplementing it, so
 * what is proven here is the code that ships.
 *
 * Run: npm run testnet:bridge
 */
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {Buffer} from 'node:buffer';
import {p256} from '@noble/curves/nist.js';
import {
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import {authenticate, discoverAnchor} from '@rosapay/anchor';
import {
  createStellarConfig,
  deviceSignatureScVal,
  walletSignatureScVal,
} from '@rosapay/stellar';
import {
  bridgeFrom,
  fundBridgeAccount,
  fundBridgeFromSmartWallet,
  payAnchorFromBridge,
  sweepToSmartWallet,
} from '../apps/mobile/src/features/wallet/anchorBridge';

const deployment = JSON.parse(readFileSync('config/testnet-deployment.json', 'utf8'));
const walletDeployment = JSON.parse(readFileSync('config/testnet-wallet-deployment.json', 'utf8'));
const configDir = process.env.ROSAPAY_STELLAR_CONFIG_DIR ?? `${process.env.HOME ?? ''}/.config/stellar`;
const relayerIdentity = process.env.ROSAPAY_RELAYER_IDENTITY ?? 'rosapay-testnet-relayer';
const deviceKeyPath = process.env.ROSAPAY_WALLET_DEVICE_KEY ?? '.stellar/wallet-device-key.json';
const evidencePath = process.env.ROSAPAY_BRIDGE_EVIDENCE ?? 'config/testnet-bridge-evidence.json';
const AMOUNT_TRY = process.env.ROSAPAY_TRY_AMOUNT ?? '300';

function secretOf(identity: string, envVar?: string): string {
  const fromEnv = envVar ? process.env[envVar]?.trim() : undefined;
  if (fromEnv) return fromEnv;
  const result = spawnSync('stellar', ['keys', 'show', identity, '--config-dir', configDir], {encoding: 'utf8'});
  const secret = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
    .split('\n')
    .map(line => line.trim())
    .find(line => /^S[A-Z2-7]{55}$/.test(line));
  if (!secret) throw new Error(`Could not read the secret key for ${identity}`);
  return secret;
}

function log(step: string, detail: unknown) {
  console.log(`\n[${step}]`, typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
}

async function main() {
  const config = createStellarConfig('testnet', {rpcUrl: deployment.rpcUrl});
  const server = new rpc.Server(config.rpcUrl);
  const relayer = Keypair.fromSecret(secretOf(relayerIdentity, 'STELLAR_RELAYER_SECRET'));
  const smartWallet: string = walletDeployment.walletContractId;
  const deviceKey = Uint8Array.from(
    Buffer.from(JSON.parse(readFileSync(deviceKeyPath, 'utf8')).privateKeyHex, 'hex'),
  );
  const devicePublicKey = Buffer.from(p256.getPublicKey(deviceKey, false));

  const anchor = await discoverAnchor('tr-mock-anchor.fly.dev');
  const usdc = anchor.currencies.find(currency => currency.code === 'USDC');
  if (!usdc?.issuer) throw new Error('The anchor lists no USDC issuer');
  const usdcSac = new Asset('USDC', usdc.issuer).contractId(config.networkPassphrase);
  const sep6 = anchor.transferServerSep6!;

  const checks: string[] = [];
  const expect = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) throw new Error(`${label} failed: ${JSON.stringify(detail, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`);
    checks.push(label);
  };

  async function usdcBalance(holder: string): Promise<bigint> {
    const built = new TransactionBuilder(await server.getAccount(relayer.publicKey()), {
      fee: '100000',
      networkPassphrase: config.networkPassphrase,
    })
      .addOperation(new Contract(usdcSac).call('balance', nativeToScVal(holder, {type: 'address'})))
      .setTimeout(30)
      .build();
    const simulation = await server.simulateTransaction(built);
    if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) return 0n;
    return BigInt(scValToNative(simulation.result.retval));
  }

  async function sep6Get(path: string, token: string) {
    const response = await fetch(`${sep6}${path}`, {headers: {Authorization: `Bearer ${token}`}});
    const body = await response.json();
    if (!response.ok) {
      // The anchor advertises `stellar:USDC:<issuer>` in its own /sep38/info
      // and, as of 2026-09-07, refuses it on the SEP-6 exchange endpoints. The
      // spec-correct value is still what is asked for first; this is the retry.
      const message = JSON.stringify(body);
      if (/unsupported (source|destination)_asset/i.test(message)) {
        const relaxed = path.replace(/(source_asset|destination_asset)=stellar:USDC:[A-Z0-9]+/, '$1=USDC');
        const retry = await fetch(`${sep6}${relaxed}`, {headers: {Authorization: `Bearer ${token}`}});
        const retried = await retry.json();
        if (retry.ok) return retried as Record<string, string>;
        throw new Error(`${path}: ${JSON.stringify(retried)}`);
      }
      throw new Error(`${path}: ${message}`);
    }
    return body as Record<string, string>;
  }

  // --- the bridge --------------------------------------------------------
  const bridge = bridgeFrom(Keypair.random());
  await fundBridgeAccount(bridge, config);
  // A classic account needs a trustline before USDC can reach it. The smart
  // wallet on the other side needs none, which is half of why the sweep works.
  const trustline = new TransactionBuilder(await server.getAccount(bridge.address), {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(Operation.changeTrust({asset: new Asset('USDC', usdc.issuer)}))
    .setTimeout(60)
    .build();
  trustline.sign(bridge.keypair);
  await server.pollTransaction((await server.sendTransaction(trustline)).hash, {attempts: 20});
  log('bridge', {address: bridge.address, smartWallet});
  checks.push('bridge-created-and-funded');

  const session = await authenticate(anchor, {
    accountId: bridge.address,
    signTransaction: async (xdr, {networkPassphrase}) => {
      const challenge = TransactionBuilder.fromXDR(xdr, networkPassphrase);
      challenge.sign(bridge.keypair);
      return challenge.toXDR();
    },
  });
  expect('the-bridge-answered-sep-10', session.account === bridge.address, session.account);

  // --- money in ----------------------------------------------------------
  const walletBefore = await usdcBalance(smartWallet);
  const opened = await sep6Get(
    `/deposit-exchange?asset_code=USDC&source_asset=iso4217:TRY&destination_asset=stellar:USDC:${usdc.issuer}` +
      `&amount=${AMOUNT_TRY}&account=${bridge.address}`,
    session.token,
  );
  log('deposit opened', {id: opened.id});
  await fetch(`${sep6}/tx/${opened.id}/simulate-bank-transfer`, {method: 'POST'});

  let deposit: Record<string, string> = {};
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const polled = await sep6Get(`/transaction?id=${opened.id}`, session.token);
    deposit = (polled.transaction ?? polled) as Record<string, string>;
    if (deposit.status === 'completed' || deposit.status === 'error') break;
  }
  expect('the-anchor-paid-the-bridge', deposit.status === 'completed', deposit.status);

  const arrived = await usdcBalance(bridge.address);
  expect('the-usdc-landed-on-a-classic-account', arrived > 0n, arrived);

  const swept = await sweepToSmartWallet({
    bridge,
    smartWalletContractId: smartWallet,
    assetCode: 'USDC',
    assetIssuer: usdc.issuer,
    config,
  });
  log('swept', {amount: swept.amount.toString(), transactionHash: swept.transactionHash});

  const walletAfter = await usdcBalance(smartWallet);
  expect('the-smart-wallet-received-it', walletAfter - walletBefore === arrived, {
    walletBefore,
    walletAfter,
    arrived,
  });
  // Nothing is left behind in an account whose key is only software.
  expect('the-bridge-kept-nothing', (await usdcBalance(bridge.address)) === 0n);

  // --- money out ---------------------------------------------------------
  // Half of what just arrived, so the run leaves the wallet with a balance.
  const outAmount = arrived / 2n;
  const outDecimal = `${outAmount / 10_000_000n}.${(outAmount % 10_000_000n).toString().padStart(7, '0')}`;

  const withdrawal = await sep6Get(
    `/withdraw-exchange?asset_code=USDC&source_asset=stellar:USDC:${usdc.issuer}` +
      `&destination_asset=iso4217:TRY&amount=${outDecimal}&type=bank_account` +
      `&dest=TR330006100519786457841326`,
    session.token,
  );
  log('withdrawal opened', {id: withdrawal.id, to: withdrawal.account_id, memo: withdrawal.memo});

  // The wallet's own signer authorizes moving its money to the bridge; the
  // relayer pays the fee, as it does for every payment this app makes.
  await fundBridgeFromSmartWallet({
    bridge,
    smartWalletContractId: smartWallet,
    assetCode: 'USDC',
    assetIssuer: usdc.issuer,
    amount: outAmount,
    relayerAddress: relayer.publicKey(),
    relayerSign: async xdr => {
      const transaction = TransactionBuilder.fromXDR(xdr, config.networkPassphrase);
      transaction.sign(relayer);
      return {signedTxXdr: transaction.toXDR()};
    },
    authorizeEntry: (entry, _signer, validUntilLedger, networkPassphrase) =>
      authorizeEntry(
        entry,
        async (_preimage, payload) => ({
          signatureScVal: walletSignatureScVal(
            'device',
            deviceSignatureScVal(
              devicePublicKey,
              Buffer.from(
                p256.sign(Buffer.from(payload), deviceKey, {prehash: false, lowS: true}),
              ),
            ),
          ),
        }),
        validUntilLedger,
        networkPassphrase ?? config.networkPassphrase,
      ),
    config,
  });
  expect('the-wallet-funded-the-bridge', (await usdcBalance(bridge.address)) === outAmount);

  const paid = await payAnchorFromBridge({
    bridge,
    destination: withdrawal.account_id!,
    memo: withdrawal.memo!,
    assetCode: 'USDC',
    assetIssuer: usdc.issuer,
    amount: outDecimal,
    config,
  });
  log('paid the anchor', paid);

  let settled: Record<string, string> = {};
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    const polled = await sep6Get(`/transaction?id=${withdrawal.id}`, session.token);
    settled = (polled.transaction ?? polled) as Record<string, string>;
    if (settled.status === 'completed' || settled.status === 'error') break;
  }
  expect('the-anchor-paid-out-lira', settled.status === 'completed', settled.status);
  expect('the-bridge-kept-nothing-again', (await usdcBalance(bridge.address)) === 0n);

  const evidence = {
    network: 'testnet',
    anchor: anchor.homeDomain,
    smartWallet,
    bridge: bridge.address,
    relayer: relayer.publicKey(),
    onRamp: {
      soldTry: AMOUNT_TRY,
      usdcToBridge: arrived.toString(),
      anchorTransaction: deposit.stellar_transaction_id ?? null,
      sweepTransaction: swept.transactionHash,
      smartWalletBefore: walletBefore.toString(),
      smartWalletAfter: walletAfter.toString(),
    },
    offRamp: {
      soldUsdc: outDecimal,
      memo: withdrawal.memo ?? null,
      paymentHash: paid.transactionHash,
      receivedTry: settled.amount_out ?? null,
      status: settled.status,
    },
    whyABridge: [
      'SEP-10 authenticates an account; a contract cannot sign a challenge and this anchor publishes no SEP-45',
      "every SEP-6 door refuses a contract address: 'account' must be a Stellar G... or M... address",
      'Soroban transactions cannot carry a memo, and a SAC transfer reaches Horizon as invoke_host_function rather than as a payment',
    ],
    ranAt: new Date().toISOString(),
    checks,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`\n${JSON.stringify(evidence, null, 2)}`);
}

await main();
