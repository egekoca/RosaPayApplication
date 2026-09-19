/**
 * Proves the Rosa smart wallet on Testnet: a P-256 key held by the device
 * authorizes a wallet operation through `__check_auth`, while a separate relayer
 * account is the transaction source and fee payer. This is the contract-side
 * half of the native signer; the platform key replaces the local key here.
 */
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {p256} from '@noble/curves/nist.js';
import {Buffer} from 'node:buffer';
import {
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';

const deployment = JSON.parse(readFileSync('config/testnet-wallet-deployment.json', 'utf8'));
const settlement = JSON.parse(readFileSync('config/testnet-deployment.json', 'utf8'));
const configDir = process.env.ROSAPAY_STELLAR_CONFIG_DIR ?? `${process.env.HOME ?? ''}/.config/stellar`;
const relayerIdentity = process.env.ROSAPAY_RELAYER_IDENTITY ?? 'rosapay-testnet-relayer';
const deviceKeyPath = process.env.ROSAPAY_WALLET_DEVICE_KEY ?? '.stellar/wallet-device-key.json';
const evidencePath = process.env.ROSAPAY_WALLET_EVIDENCE ?? 'config/testnet-wallet-evidence.json';

/**
 * Where a signing key comes from.
 *
 * The environment wins, because that is how the API and the worker are
 * configured and a machine should be set up in one place. The Stellar CLI is
 * the fallback for a checkout that has identities but no env file.
 *
 * The CLI's own global config is the default location: `stellar config migrate`
 * moves identities out of a repository-local `.stellar` and a stale copy left
 * behind there would otherwise be picked up in preference to the real key.
 */
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

async function loadDeviceKey(): Promise<Uint8Array> {
  const stored = JSON.parse(readFileSync(deviceKeyPath, 'utf8'));
  return Uint8Array.from(Buffer.from(stored.privateKeyHex, 'hex'));
}

/**
 * The wallet verifies a signature over the authorization payload itself, not
 * over a hash of it, so the payload is signed as a prehash. Soroban also only
 * accepts low-S signatures, which is what this curve implementation produces.
 */
function signPayload(secretKey: Uint8Array, payload: Buffer): Buffer {
  const signature = p256.sign(Uint8Array.from(payload), secretKey, {prehash: false, lowS: true});
  const bytes = signature instanceof Uint8Array ? signature : signature.toBytes('compact');
  throw_if(bytes.length !== 64, 'Expected a 64-byte P-256 signature');
  return Buffer.from(bytes);
}

function throw_if(condition: boolean, message: string): void {
  if (condition) throw new Error(message);
}

function walletSignature(publicKey: Buffer, signature: Buffer): xdr.ScVal {
  // Matches the contract's `WalletSignature` struct, whose fields are ordered.
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({key: nativeToScVal('public_key', {type: 'symbol'}), val: xdr.ScVal.scvBytes(publicKey)}),
    new xdr.ScMapEntry({key: nativeToScVal('signature', {type: 'symbol'}), val: xdr.ScVal.scvBytes(signature)}),
  ]);
}

async function main() {
  const relayer = Keypair.fromSecret(secretOf(relayerIdentity, 'STELLAR_RELAYER_SECRET'));
  const server = new rpc.Server(settlement.rpcUrl);
  const devicePublicKey = Buffer.from(deployment.devicePublicKey, 'hex');
  const deviceKey = await loadDeviceKey();

  // The wallet authorizes adding a second device signer to itself.
  const addedSigner = Buffer.from(p256.getPublicKey(p256.utils.randomSecretKey(), false));

  const wallet = new Contract(deployment.walletContractId);
  const source = await server.getAccount(relayer.publicKey());
  const call = wallet.call('add_signer', xdr.ScVal.scvBytes(addedSigner));
  const unsigned = new TransactionBuilder(source, {fee: '2000000', networkPassphrase: Networks.TESTNET})
    .addOperation(call)
    .setTimeout(60)
    .build();

  const simulation = await server.simulateTransaction(unsigned);
  if (!rpc.Api.isSimulationSuccess(simulation)) {
    throw new Error(`Simulation failed: ${JSON.stringify(simulation)}`);
  }
  const entries = simulation.result?.auth ?? [];
  throw_if(entries.length === 0, 'The wallet did not require an authorization entry');

  const validUntil = (await server.getLatestLedger()).sequence + 120;
  const signedEntries = await Promise.all(
    entries.map(entry =>
      authorizeEntry(
        entry,
        async (_preimage, payload) => ({
          signatureScVal: walletSignature(devicePublicKey, signPayload(deviceKey, Buffer.from(payload))),
        }),
        validUntil,
        Networks.TESTNET,
      ),
    ),
  );

  const authorized = new TransactionBuilder(await server.getAccount(relayer.publicKey()), {
    fee: '2000000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: call.body().invokeHostFunctionOp().hostFunction(),
        auth: signedEntries,
      }),
    )
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(authorized);
  prepared.sign(relayer);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error(`Submission failed: ${JSON.stringify(sent.errorResult)}`);
  const confirmed = await server.pollTransaction(sent.hash, {attempts: 20});
  if (confirmed.status !== 'SUCCESS') throw new Error(`Wallet authorization failed: ${confirmed.status}`);

  const check = await server.simulateTransaction(
    new TransactionBuilder(await server.getAccount(relayer.publicKey()), {
      fee: '100000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(wallet.call('is_signer', xdr.ScVal.scvBytes(addedSigner)))
      .setTimeout(30)
      .build(),
  );
  throw_if(!rpc.Api.isSimulationSuccess(check), 'Could not read the wallet signer list back');
  const added = check.result?.retval.value() === true;
  throw_if(!added, 'The wallet did not record the new signer');

  const evidence = {
    network: 'testnet',
    walletContractId: deployment.walletContractId,
    devicePublicKey: deployment.devicePublicKey,
    addedSigner: addedSigner.toString('hex'),
    relayer: relayer.publicKey(),
    transactionHash: sent.hash,
    ledger: confirmed.ledger,
    authorizedAt: new Date().toISOString(),
    checks: ['p256-check-auth', 'relayer-paid-fee', 'signer-added'],
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
}

await main();
