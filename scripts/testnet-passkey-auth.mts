/**
 * Proves the passkey path on Testnet: a WebAuthn assertion authorizes the smart
 * wallet, and one made for a different transaction does not.
 *
 * This is the half of the passkey work that has to be right before any native
 * module is written, because it is the half nothing else can compensate for. A
 * passkey never signs the payload it is handed - it builds a client-data
 * document around it and signs `authenticatorData || SHA-256(clientData)` - so
 * the contract's job is to prove that a genuine signature was made *about this
 * transaction*. That is what these runs check, on the real network.
 *
 * The assertion here is assembled locally rather than by a platform
 * authenticator, byte for byte the way iOS and Android build one. Every rule the
 * contract enforces is exercised against the live ledger:
 *
 *   - a well-formed assertion authorizes the wallet;
 *   - the same genuine assertion is refused for a different payload;
 *   - a registration ceremony cannot be replayed as a sign-in;
 *   - an assertion where the owner was present but not verified is refused;
 *   - a device-key signature is refused for a key registered as a passkey.
 *
 * Run: npm run testnet:passkey
 */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {Buffer} from 'node:buffer';
import {p256} from '@noble/curves/nist.js';
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
import {
  deviceSignatureScVal,
  passkeyAssertionScVal,
  walletSignatureScVal,
} from '@rosapay/stellar';

const deployment = JSON.parse(readFileSync('config/testnet-deployment.json', 'utf8'));
const wallet = JSON.parse(readFileSync('config/testnet-wallet-deployment.json', 'utf8'));
const configDir = process.env.ROSAPAY_STELLAR_CONFIG_DIR ?? `${process.env.HOME ?? ''}/.config/stellar`;
const relayerIdentity = process.env.ROSAPAY_RELAYER_IDENTITY ?? 'rosapay-testnet-relayer';
const deviceKeyPath = process.env.ROSAPAY_WALLET_DEVICE_KEY ?? '.stellar/wallet-device-key.json';
const passkeyPath = process.env.ROSAPAY_WALLET_PASSKEY ?? '.stellar/wallet-passkey.json';
const evidencePath = process.env.ROSAPAY_PASSKEY_EVIDENCE ?? 'config/testnet-passkey-evidence.json';

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

function loadOrCreateKey(path: string): {privateKey: Uint8Array; publicKey: Buffer} {
  try {
    const stored = JSON.parse(readFileSync(path, 'utf8'));
    const privateKey = Uint8Array.from(Buffer.from(stored.privateKeyHex, 'hex'));
    return {privateKey, publicKey: Buffer.from(p256.getPublicKey(privateKey, false))};
  } catch {
    const privateKey = p256.utils.randomSecretKey();
    writeFileSync(path, `${JSON.stringify({privateKeyHex: Buffer.from(privateKey).toString('hex')}, null, 2)}\n`);
    return {privateKey, publicKey: Buffer.from(p256.getPublicKey(privateKey, false))};
  }
}

/**
 * What a platform authenticator reports after a Face ID prompt: the owner was
 * present, the owner was verified, and the credential is one the platform is
 * allowed to back up and has backed up. That last pair is the passkey's whole
 * reason for being here - it is what makes the account survive a lost phone.
 */
const FLAGS_SYNCED_AND_VERIFIED = 0x01 | 0x04 | 0x08 | 0x10;

function authenticatorData(flags: number): Buffer {
  return Buffer.concat([
    Buffer.alloc(32, 0x49), // RP ID hash; enforced by the platform, not on-chain
    Buffer.from([flags]),
    Buffer.from([0, 0, 0, 1]), // signature counter
  ]);
}

type Assertion = {
  signature: Buffer;
  authenticatorData: Buffer;
  clientDataJSON: Buffer;
};

/** Builds an assertion the way a real authenticator does. */
function assert(
  privateKey: Uint8Array,
  payload: Buffer,
  {
    ceremony = 'webauthn.get',
    flags = FLAGS_SYNCED_AND_VERIFIED,
    challenge = payload.toString('base64url'),
  }: {ceremony?: string; flags?: number; challenge?: string} = {},
): Assertion {
  const clientDataJSON = Buffer.from(
    JSON.stringify({
      type: ceremony,
      challenge,
      origin: 'https://lumenade-pay.vercel.app',
      crossOrigin: false,
    }),
  );
  const authData = authenticatorData(flags);
  const signed = Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()]);
  const signature = p256.sign(createHash('sha256').update(signed).digest(), privateKey, {
    prehash: false,
    lowS: true,
  });
  return {
    signature: Buffer.from(signature),
    authenticatorData: authData,
    clientDataJSON,
  };
}

async function main() {
  const relayer = Keypair.fromSecret(secretOf(relayerIdentity, 'STELLAR_RELAYER_SECRET'));
  const server = new rpc.Server(deployment.rpcUrl);
  const walletContractId: string = wallet.walletContractId;
  const contract = new Contract(walletContractId);

  const device = loadOrCreateKey(deviceKeyPath);
  const passkey = loadOrCreateKey(passkeyPath);

  const checks: string[] = [];
  const expect = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) throw new Error(`${label} failed: ${JSON.stringify(detail)}`);
    checks.push(label);
  };

  /**
   * Runs one wallet operation, authorized by whichever signature the caller
   * builds. Returning the failure rather than throwing is what lets the refusal
   * cases be assertions instead of comments.
   */
  async function authorize(
    call: xdr.Operation,
    sign: (payload: Buffer) => xdr.ScVal,
  ): Promise<{ok: true; hash: string; ledger?: number} | {ok: false; reason: string}> {
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
      // A wallet that refuses the signature fails here, during simulation of
      // the authorized transaction. That is the refusal these cases are after.
      return {ok: false, reason: `prepare: ${String(error)}`.slice(0, 300)};
    }
    prepared.sign(relayer);
    const sent = await server.sendTransaction(prepared);
    if (sent.status === 'ERROR') return {ok: false, reason: `submit: ${JSON.stringify(sent.errorResult)}`};
    const confirmed = await server.pollTransaction(sent.hash, {attempts: 30});
    if (confirmed.status !== 'SUCCESS') return {ok: false, reason: `status: ${confirmed.status}`};
    return {ok: true, hash: sent.hash, ledger: confirmed.ledger};
  }

  const passkeySignature = (payload: Buffer, options?: Parameters<typeof assert>[2]) => {
    const assertion = assert(passkey.privateKey, payload, options);
    return walletSignatureScVal(
      'passkey',
      passkeyAssertionScVal({
        publicKey: passkey.publicKey,
        signature: assertion.signature,
        authenticatorData: assertion.authenticatorData,
        clientDataJSON: assertion.clientDataJSON,
      }),
    );
  };

  const deviceSignature = (payload: Buffer, privateKey: Uint8Array, publicKey: Buffer) =>
    walletSignatureScVal(
      'device',
      deviceSignatureScVal(
        publicKey,
        Buffer.from(p256.sign(payload, privateKey, {prehash: false, lowS: true})),
      ),
    );

  const kind = (name: 'Device' | 'Passkey') =>
    xdr.ScVal.scvVec([nativeToScVal(name, {type: 'symbol'})]);

  // 1. The device signer enrols the passkey, which is how a real phone would do
  //    it: an already-trusted key authorizes the new one.
  const enrol = await authorize(
    contract.call('add_signer', xdr.ScVal.scvBytes(passkey.publicKey), kind('Passkey')),
    payload => deviceSignature(payload, device.privateKey, device.publicKey),
  );
  if (!enrol.ok) {
    // Re-running the script finds the passkey already enrolled, which is fine.
    if (!enrol.reason.includes('Error(Contract, #3)')) throw new Error(`enrolment: ${enrol.reason}`);
    console.log(JSON.stringify({event: 'passkey_already_enrolled'}));
  }
  checks.push('device-signer-enrolled-the-passkey');

  // 2. The passkey authorizes a wallet operation of its own.
  const secondDevice = Buffer.from(p256.getPublicKey(p256.utils.randomSecretKey(), false));
  const authorized = await authorize(
    contract.call('add_signer', xdr.ScVal.scvBytes(secondDevice), kind('Device')),
    payload => passkeySignature(payload),
  );
  expect('passkey-authorized-the-wallet', authorized.ok, authorized);

  // 3. An assertion the owner really made, for a different transaction. This is
  //    the check the whole design turns on.
  const replayed = await authorize(
    contract.call('remove_signer', xdr.ScVal.scvBytes(secondDevice)),
    payload => {
      const elsewhere = Buffer.alloc(32, 0xab);
      return passkeySignature(elsewhere, {challenge: elsewhere.toString('base64url')});
    },
  );
  expect('refuses-an-assertion-made-for-another-payload', !replayed.ok, replayed);

  // 4. A registration ceremony, signed by the same key over this exact payload.
  const registration = await authorize(
    contract.call('remove_signer', xdr.ScVal.scvBytes(secondDevice)),
    payload => passkeySignature(payload, {ceremony: 'webauthn.create'}),
  );
  expect('refuses-a-registration-ceremony', !registration.ok, registration);

  // 5. Present, but not verified: someone held the phone without proving they
  //    are the owner.
  const unverified = await authorize(
    contract.call('remove_signer', xdr.ScVal.scvBytes(secondDevice)),
    payload => passkeySignature(payload, {flags: 0x01 | 0x08}),
  );
  expect('refuses-an-unverified-assertion', !unverified.ok, unverified);

  // 6. The passkey's own key, offered as if it were a device key. The contract
  //    checks a key by the rules it was registered under, never by the ones the
  //    caller picked.
  const wrongKind = await authorize(
    contract.call('remove_signer', xdr.ScVal.scvBytes(secondDevice)),
    payload => deviceSignature(payload, passkey.privateKey, passkey.publicKey),
  );
  expect('refuses-a-device-signature-for-a-passkey', !wrongKind.ok, wrongKind);

  // Tidy up, so a re-run starts from the same place.
  const cleanup = await authorize(
    contract.call('remove_signer', xdr.ScVal.scvBytes(secondDevice)),
    payload => passkeySignature(payload),
  );
  expect('passkey-authorized-a-second-operation', cleanup.ok, cleanup);

  const evidence = {
    network: 'testnet',
    walletContractId,
    wasmHash: wallet.wasmHash,
    passkeyPublicKey: passkey.publicKey.toString('hex'),
    devicePublicKey: device.publicKey.toString('hex'),
    relayer: relayer.publicKey(),
    authorizedTransactionHash: authorized.ok ? authorized.hash : null,
    authorizedLedger: authorized.ok ? authorized.ledger : null,
    assertionShape: 'authenticatorData || SHA-256(clientDataJSON), signed as secp256r1',
    flags: 'user present, user verified, backup eligible, backed up',
    ranAt: new Date().toISOString(),
    checks,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
}

await main();
