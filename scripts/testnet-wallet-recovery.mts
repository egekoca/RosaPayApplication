/**
 * Proves that a lost phone does not take the wallet with it.
 *
 * This is the claim the whole passkey design exists to make good on, and until
 * now it was only a claim: `contracts/wallet` has had `rotate` since the first
 * deployment and nothing ever called it, so ADR 0002 said in plain words that
 * losing the device may make the wallet inaccessible.
 *
 * The run acts out the real thing on Testnet:
 *
 *   1. a wallet exists, controlled by a device key that is now gone;
 *   2. a replacement phone makes its own key, which no wallet has ever seen;
 *   3. the recovery passkey - the one the platform synced to the new phone -
 *      rotates the lost signer out and the new one in;
 *   4. the new phone can authorize the wallet, and the lost key cannot;
 *   5. and the recovery signer still cannot spend, only rotate.
 *
 * Run: npm run testnet:recovery
 */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {Buffer} from 'node:buffer';
import {p256} from '@noble/curves/nist.js';
import {
  Address,
  Contract,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import {deviceSignatureScVal, passkeyAssertionScVal, walletSignatureScVal} from '@rosapay/stellar';

const deployment = JSON.parse(readFileSync('config/testnet-deployment.json', 'utf8'));
const configDir = process.env.ROSAPAY_STELLAR_CONFIG_DIR ?? `${process.env.HOME ?? ''}/.config/stellar`;
const relayerIdentity = process.env.ROSAPAY_RELAYER_IDENTITY ?? 'rosapay-testnet-relayer';
const walletWasm = 'contracts/target/wasm32v1-none/release/rosapay_wallet.wasm';
const evidencePath = process.env.ROSAPAY_RECOVERY_EVIDENCE ?? 'config/testnet-recovery-evidence.json';

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

type Key = {privateKey: Uint8Array; publicKey: Buffer};

function newKey(): Key {
  const privateKey = p256.utils.randomSecretKey();
  return {privateKey, publicKey: Buffer.from(p256.getPublicKey(privateKey, false))};
}

const AUTHENTICATOR_DATA = Buffer.concat([
  Buffer.alloc(32, 0x49),
  Buffer.from([0x01 | 0x04 | 0x08 | 0x10]), // present, verified, backup eligible, backed up
  Buffer.from([0, 0, 0, 1]),
]);

/** Builds an assertion exactly as a platform authenticator does. */
function passkeySignature(key: Key, payload: Buffer): xdr.ScVal {
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: payload.toString('base64url'),
      origin: 'https://rosa-pay-app.vercel.app',
      crossOrigin: false,
    }),
  );
  const signed = Buffer.concat([
    AUTHENTICATOR_DATA,
    createHash('sha256').update(clientDataJSON).digest(),
  ]);
  const signature = p256.sign(createHash('sha256').update(signed).digest(), key.privateKey, {
    prehash: false,
    lowS: true,
  });
  return walletSignatureScVal(
    'passkey',
    passkeyAssertionScVal({
      publicKey: key.publicKey,
      signature: Buffer.from(signature),
      authenticatorData: AUTHENTICATOR_DATA,
      clientDataJSON,
    }),
  );
}

function deviceSignature(key: Key, payload: Buffer): xdr.ScVal {
  return walletSignatureScVal(
    'device',
    deviceSignatureScVal(
      key.publicKey,
      Buffer.from(p256.sign(payload, key.privateKey, {prehash: false, lowS: true})),
    ),
  );
}

const signerKind = (kind: 'Device' | 'Passkey') =>
  xdr.ScVal.scvVec([nativeToScVal(kind, {type: 'symbol'})]);

const recoverySigner = (publicKey: Buffer, kind: 'Device' | 'Passkey') =>
  xdr.ScVal.scvMap([
    new xdr.ScMapEntry({key: nativeToScVal('kind', {type: 'symbol'}), val: signerKind(kind)}),
    new xdr.ScMapEntry({
      key: nativeToScVal('public_key', {type: 'symbol'}),
      val: xdr.ScVal.scvBytes(publicKey),
    }),
  ]);

async function main() {
  const relayer = Keypair.fromSecret(secretOf(relayerIdentity, 'STELLAR_RELAYER_SECRET'));
  const server = new rpc.Server(deployment.rpcUrl);

  const checks: string[] = [];
  const expect = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) throw new Error(`${label} failed: ${JSON.stringify(detail)}`);
    checks.push(label);
  };

  async function submit(build: (source: Awaited<ReturnType<rpc.Server['getAccount']>>) => ReturnType<TransactionBuilder['build']>) {
    const prepared = await server.prepareTransaction(build(await server.getAccount(relayer.publicKey())));
    prepared.sign(relayer);
    const sent = await server.sendTransaction(prepared);
    if (sent.status === 'ERROR') throw new Error(`Submission failed: ${JSON.stringify(sent.errorResult)}`);
    const confirmed = await server.pollTransaction(sent.hash, {attempts: 30});
    if (confirmed.status !== 'SUCCESS') throw new Error(`Transaction failed: ${confirmed.status}`);
    return {hash: sent.hash, confirmed};
  }

  /** Runs one wallet call, and reports refusal rather than throwing on it. */
  async function authorize(
    call: xdr.Operation,
    sign: (payload: Buffer) => xdr.ScVal,
  ): Promise<{ok: true; hash: string} | {ok: false; reason: string}> {
    const unsigned = new TransactionBuilder(await server.getAccount(relayer.publicKey()), {
      fee: '5000000',
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(call)
      .setTimeout(60)
      .build();

    const simulation = await server.simulateTransaction(unsigned);
    if (!rpc.Api.isSimulationSuccess(simulation)) {
      return {ok: false, reason: `simulation: ${JSON.stringify(simulation)}`.slice(0, 200)};
    }
    const entries = simulation.result?.auth ?? [];
    if (entries.length === 0) return {ok: false, reason: 'no authorization entry'};
    const validUntil = (await server.getLatestLedger()).sequence + 100;

    let signedEntries: xdr.SorobanAuthorizationEntry[];
    try {
      signedEntries = await Promise.all(
        entries.map(entry =>
          authorizeEntry(
            entry,
            async (_preimage, payload) => ({signatureScVal: sign(Buffer.from(payload))}),
            validUntil,
            Networks.TESTNET,
          ),
        ),
      );
    } catch (error) {
      return {ok: false, reason: `authorize: ${String(error)}`.slice(0, 200)};
    }

    const authorized = new TransactionBuilder(await server.getAccount(relayer.publicKey()), {
      fee: '5000000',
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

    let prepared;
    try {
      prepared = await server.prepareTransaction(authorized);
    } catch (error) {
      return {ok: false, reason: `prepare: ${String(error)}`.slice(0, 300)};
    }
    prepared.sign(relayer);
    const sent = await server.sendTransaction(prepared);
    if (sent.status === 'ERROR') return {ok: false, reason: `submit: ${JSON.stringify(sent.errorResult)}`};
    const confirmed = await server.pollTransaction(sent.hash, {attempts: 30});
    if (confirmed.status !== 'SUCCESS') return {ok: false, reason: `status: ${confirmed.status}`};
    return {ok: true, hash: sent.hash};
  }

  // A wallet as the app creates one: a device key that signs payments, and a
  // passkey that exists only so this moment is survivable.
  const lostPhone = newKey();
  const passkey = newKey();
  const wasm = readFileSync(walletWasm);
  const wasmHash = createHash('sha256').update(wasm).digest();

  const deployed = await submit(source =>
    new TransactionBuilder(source, {fee: '10000000', networkPassphrase: Networks.TESTNET})
      .addOperation(
        Operation.createCustomContract({
          address: new Address(relayer.publicKey()),
          wasmHash,
          salt: Buffer.from(crypto.getRandomValues(new Uint8Array(32))),
          constructorArgs: [
            xdr.ScVal.scvBytes(lostPhone.publicKey),
            signerKind('Device'),
            recoverySigner(passkey.publicKey, 'Passkey'),
          ],
        }),
      )
      .setTimeout(60)
      .build(),
  );
  const walletContractId = scValToNative(deployed.confirmed.returnValue!) as string;
  const wallet = new Contract(walletContractId);
  console.log(JSON.stringify({event: 'wallet_created', walletContractId}));
  checks.push('wallet-created-with-a-recovery-passkey');

  // The phone is gone. A new one makes a key of its own, which this wallet has
  // never seen and which nothing on the old phone could have produced.
  const newPhone = newKey();

  // The recovery passkey may do exactly one thing, and this is it.
  const rotated = await authorize(
    wallet.call(
      'rotate',
      xdr.ScVal.scvBytes(lostPhone.publicKey),
      xdr.ScVal.scvBytes(newPhone.publicKey),
      signerKind('Device'),
    ),
    payload => passkeySignature(passkey, payload),
  );
  expect('the-passkey-rotated-the-lost-signer-out', rotated.ok, rotated);

  // The new phone now controls the wallet on its own.
  const second = newKey();
  const authorized = await authorize(
    wallet.call('add_signer', xdr.ScVal.scvBytes(second.publicKey), signerKind('Device')),
    payload => deviceSignature(newPhone, payload),
  );
  expect('the-new-phone-can-authorize-the-wallet', authorized.ok, authorized);

  // And the lost key cannot, which is the other half of a recovery.
  const fromLostPhone = await authorize(
    wallet.call('remove_signer', xdr.ScVal.scvBytes(second.publicKey)),
    payload => deviceSignature(lostPhone, payload),
  );
  expect('the-lost-phone-can-no-longer-authorize', !fromLostPhone.ok, fromLostPhone);

  // The passkey rescued the wallet but still cannot spend from it: `rotate` is
  // the whole of its authority, and the contract holds that line.
  const passkeySpending = await authorize(
    wallet.call('remove_signer', xdr.ScVal.scvBytes(second.publicKey)),
    payload => passkeySignature(passkey, payload),
  );
  expect('the-recovery-passkey-still-cannot-do-anything-else', !passkeySpending.ok, passkeySpending);

  const evidence = {
    network: 'testnet',
    walletContractId,
    wasmHash: wasmHash.toString('hex'),
    lostDeviceKey: lostPhone.publicKey.toString('hex'),
    recoveryPasskey: passkey.publicKey.toString('hex'),
    replacementDeviceKey: newPhone.publicKey.toString('hex'),
    rotationTransactionHash: rotated.ok ? rotated.hash : null,
    relayer: relayer.publicKey(),
    ranAt: new Date().toISOString(),
    checks,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
}

await main();
