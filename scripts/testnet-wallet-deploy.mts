/**
 * Deploys a smart wallet on Testnet the way the app does, and records it.
 *
 * The wallet is created with two keys, not one, and that is the whole point of
 * this script existing. A wallet with a single device signer is a wallet that
 * dies with the handset; the recovery signer is what lets a lost phone be
 * rotated out later. `contracts/wallet` has supported this from the start and
 * nothing was using it.
 *
 * Both keys here are local P-256 keys standing in for what the platform holds:
 * on a real phone the device signer lives in the Secure Enclave or the Android
 * Keystore, and the recovery signer is a passkey the platform syncs to the
 * owner's other devices.
 *
 * Run: npm run testnet:wallet-deploy
 */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {Buffer} from 'node:buffer';
import {p256} from '@noble/curves/nist.js';
import {
  Address,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  hash,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

const deployment = JSON.parse(readFileSync('config/testnet-deployment.json', 'utf8'));
const configDir = process.env.ROSAPAY_STELLAR_CONFIG_DIR ?? `${process.env.HOME ?? ''}/.config/stellar`;
const relayerIdentity = process.env.ROSAPAY_RELAYER_IDENTITY ?? 'rosapay-testnet-relayer';
const deviceKeyPath = process.env.ROSAPAY_WALLET_DEVICE_KEY ?? '.stellar/wallet-device-key.json';
const recoveryKeyPath = process.env.ROSAPAY_WALLET_RECOVERY_KEY ?? '.stellar/wallet-recovery-key.json';
const walletWasm = 'contracts/target/wasm32v1-none/release/rosapay_wallet.wasm';
const manifestPath = 'config/testnet-wallet-deployment.json';

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
 * A key is reused when it already exists, so re-running this does not silently
 * strand a wallet whose signer no longer exists anywhere.
 */
function loadOrCreateKey(path: string): {privateKey: Uint8Array; publicKey: Buffer} {
  if (existsSync(path)) {
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    const privateKey = Uint8Array.from(Buffer.from(stored.privateKeyHex, 'hex'));
    return {privateKey, publicKey: Buffer.from(p256.getPublicKey(privateKey, false))};
  }
  const privateKey = p256.utils.randomSecretKey();
  mkdirSync(path.split('/').slice(0, -1).join('/'), {recursive: true});
  writeFileSync(
    path,
    `${JSON.stringify({privateKeyHex: Buffer.from(privateKey).toString('hex')}, null, 2)}\n`,
  );
  return {privateKey, publicKey: Buffer.from(p256.getPublicKey(privateKey, false))};
}

/** `SignerKind`, a unit-variant enum, which XDR carries as a one-element vector. */
function signerKind(kind: 'Device' | 'Passkey'): xdr.ScVal {
  return xdr.ScVal.scvVec([nativeToScVal(kind, {type: 'symbol'})]);
}

/** `RecoverySigner`, whose fields are ordered. */
function recoverySigner(publicKey: Buffer, kind: 'Device' | 'Passkey'): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({key: nativeToScVal('kind', {type: 'symbol'}), val: signerKind(kind)}),
    new xdr.ScMapEntry({
      key: nativeToScVal('public_key', {type: 'symbol'}),
      val: xdr.ScVal.scvBytes(publicKey),
    }),
  ]);
}

async function submit(
  server: rpc.Server,
  relayer: Keypair,
  build: (source: Awaited<ReturnType<rpc.Server['getAccount']>>) => ReturnType<TransactionBuilder['build']>,
) {
  const prepared = await server.prepareTransaction(build(await server.getAccount(relayer.publicKey())));
  prepared.sign(relayer);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') throw new Error(`Submission failed: ${JSON.stringify(sent.errorResult)}`);
  const confirmed = await server.pollTransaction(sent.hash, {attempts: 30});
  if (confirmed.status !== 'SUCCESS') throw new Error(`Transaction failed: ${confirmed.status}`);
  return {hash: sent.hash, confirmed};
}

async function main() {
  const relayer = Keypair.fromSecret(secretOf(relayerIdentity, 'STELLAR_RELAYER_SECRET'));
  const server = new rpc.Server(deployment.rpcUrl);

  const device = loadOrCreateKey(deviceKeyPath);
  const recovery = loadOrCreateKey(recoveryKeyPath);
  const wasm = readFileSync(walletWasm);
  const wasmHash = hash(wasm);

  console.log(JSON.stringify({event: 'keys', device: device.publicKey.toString('hex').slice(0, 16)}));

  // Uploading is idempotent: a hash already on the ledger just succeeds again.
  const uploaded = await submit(server, relayer, source =>
    new TransactionBuilder(source, {fee: '10000000', networkPassphrase: Networks.TESTNET})
      .addOperation(Operation.uploadContractWasm({wasm}))
      .setTimeout(60)
      .build(),
  );
  console.log(JSON.stringify({event: 'wasm_uploaded', hash: wasmHash.toString('hex'), tx: uploaded.hash}));

  const deployed = await submit(server, relayer, source =>
    new TransactionBuilder(source, {fee: '10000000', networkPassphrase: Networks.TESTNET})
      .addOperation(
        Operation.createCustomContract({
          address: new Address(relayer.publicKey()),
          wasmHash,
          salt: Buffer.from(crypto.getRandomValues(new Uint8Array(32))),
          constructorArgs: [
            xdr.ScVal.scvBytes(device.publicKey),
            signerKind('Device'),
            // Soroban carries `Option<T>` as the value itself, or Void for
            // None - not as a one-element vector.
            recoverySigner(recovery.publicKey, 'Device'),
          ],
        }),
      )
      .setTimeout(60)
      .build(),
  );

  const returned = deployed.confirmed.returnValue;
  const walletContractId = returned ? scValToNative(returned) : undefined;
  if (typeof walletContractId !== 'string') {
    throw new Error('The deployment returned no contract address');
  }

  const manifest = {
    network: 'testnet',
    walletContractId,
    wasmHash: wasmHash.toString('hex'),
    devicePublicKey: device.publicKey.toString('hex'),
    deviceSignerKind: 'Device',
    recoveryPublicKey: recovery.publicKey.toString('hex'),
    recoverySignerKind: 'Device',
    deployedAt: new Date().toISOString(),
    deploymentTransactionHash: deployed.hash,
    wasmUploadTransactionHash: uploaded.hash,
    note:
      'Device and recovery private keys are kept outside the repository under .stellar/. ' +
      'On a phone the device signer is a Secure Enclave or Keystore key and the recovery ' +
      'signer is a platform-synced passkey; these local keys stand in for both.',
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
}

await main();
