import {
  Contract,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import {
  createStellarConfig,
  createWalletAuthorizeEntry,
  type StellarConfig,
} from '@rosapay/stellar';
import {uncompressedPointFromSpki} from '@rosapay/secure-signer';
import {Buffer} from 'buffer';
import {RosaPayApiClient} from '../../api';
import {createNativeRosaPaySigner} from '../../native/nativeSigner';
import {logger} from '../../shared/logger';
import {useAppStore, type SmartWallet} from '../../state/appStore';
import {
  createRemoteRelayerSigner,
  fetchRelayerIdentity,
} from '../payments/testnetSettlement';
import {createPasskeySigner, PasskeyError, type PasskeyCredential} from './passkey';
import {NativeModules} from 'react-native';

/**
 * Taking a wallet back after losing the phone that held it.
 *
 * The replacement phone arrives knowing nothing. Its Secure Enclave key is new
 * and no wallet has ever seen it; the key that used to control the wallet is
 * gone for good, because it never could be copied anywhere. The only thing that
 * crossed over is the passkey, which the platform replicated.
 *
 * So the passkey does two jobs here. First it identifies the wallet: the
 * credential it presents is looked up, and the API answers with the contract
 * address and the signer that has to be retired - both already public on the
 * ledger, so this saves a scan rather than granting anything. Then it authorizes
 * the rotation, which is the only thing the contract will let a recovery signer
 * do.
 */

export class WalletRecoveryError extends Error {
  override readonly name = 'WalletRecoveryError';

  constructor(
    readonly code: 'NO_PASSKEY' | 'NOT_FOUND' | 'CANCELLED' | 'ROTATION_FAILED',
    message: string,
  ) {
    super(message);
  }
}

type PasskeyNative = {
  assert(request: {challenge: string; relyingParty?: string}): Promise<{
    credentialId: string;
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
  }>;
};

function passkeyModule(): PasskeyNative | undefined {
  return (NativeModules as {RosaPayPasskey?: PasskeyNative}).RosaPayPasskey;
}

/**
 * Asks the platform which of its passkeys the owner wants to recover with.
 *
 * No credential id is supplied on purpose: this phone has never seen one. A
 * discoverable passkey is what makes that work, and it is why registration asks
 * for a resident key.
 */
export async function findRecoverableWallet(
  client: RosaPayApiClient = new RosaPayApiClient({baseUrl: useAppStore.getState().apiBaseUrl}),
  module = passkeyModule(),
): Promise<{walletContractId: string; retiredSigner: string; credentialId: string}> {
  if (!module) {
    throw new WalletRecoveryError('NO_PASSKEY', 'This phone cannot use passkeys, so it cannot recover a wallet.');
  }

  // The challenge is not verified by anyone here: this assertion proves the
  // owner holds the credential to the platform, and the rotation below is what
  // the contract actually checks. It is still random, because a fixed one would
  // make the prompt replayable in the platform's own history.
  const challenge = new Uint8Array(32);
  globalThis.crypto.getRandomValues(challenge);

  let asserted;
  try {
    asserted = await module.assert({challenge: toBase64Url(challenge)});
  } catch (error) {
    const code = (error as {code?: string} | undefined)?.code;
    if (code === 'USER_CANCELLED') {
      throw new WalletRecoveryError('CANCELLED', 'The prompt was dismissed.');
    }
    throw new WalletRecoveryError('NO_PASSKEY', 'No passkey on this phone could be used.');
  }

  const found = await client.findRecoverableWallet(asserted.credentialId).catch(() => null);
  if (!found) {
    throw new WalletRecoveryError(
      'NOT_FOUND',
      'That passkey does not belong to a Lumenade Pay wallet.',
    );
  }
  return {...found, credentialId: asserted.credentialId};
}

/**
 * Rotates the lost signer out and this phone's new key in.
 *
 * The passkey authorizes it; the relayer pays the fee, as it does for every
 * other transaction this app makes. Nothing here can spend the wallet - the
 * contract restricts a recovery signer to `rotate` and refuses everything else,
 * which is checked on-chain by `npm run testnet:recovery`.
 */
export async function recoverWallet(input: {
  walletContractId: string;
  retiredSigner: string;
  credential: PasskeyCredential;
  config?: StellarConfig;
}): Promise<SmartWallet> {
  const config = input.config ?? createStellarConfig('testnet');
  const server = new rpc.Server(config.rpcUrl);
  const baseUrl = useAppStore.getState().apiBaseUrl;

  // The replacement key, made here and never anywhere else.
  const signer = createNativeRosaPaySigner();
  const identity =
    (await signer.getIdentity().catch(() => null)) ??
    (await signer.createIdentity('Lumenade Pay').catch(() => null));
  if (!identity?.publicKey) {
    throw new WalletRecoveryError(
      'ROTATION_FAILED',
      'Set a screen lock on this phone so it can hold a payment key, then try again.',
    );
  }
  const replacement = Buffer.from(
    uncompressedPointFromSpki(Uint8Array.from(Buffer.from(identity.publicKey, 'base64'))),
  );
  const retired = Buffer.from(
    uncompressedPointFromSpki(Uint8Array.from(Buffer.from(input.retiredSigner, 'base64'))),
  );

  const relayer = await fetchRelayerIdentity(baseUrl);
  const relayerSigner = createRemoteRelayerSigner(baseUrl);
  const call = new Contract(input.walletContractId).call(
    'rotate',
    xdr.ScVal.scvBytes(retired),
    xdr.ScVal.scvBytes(replacement),
    // `SignerKind::Device`: a unit-variant enum, which XDR carries as a
    // one-element vector.
    xdr.ScVal.scvVec([nativeToScVal('Device', {type: 'symbol'})]),
  );

  const built = new TransactionBuilder(await server.getAccount(relayer.address), {
    fee: '5000000',
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(call)
    .setTimeout(60)
    .build();

  const simulation = await server.simulateTransaction(built);
  if (!rpc.Api.isSimulationSuccess(simulation)) {
    throw new WalletRecoveryError('ROTATION_FAILED', 'This wallet could not be prepared for recovery.');
  }

  const latestLedger = (await server.getLatestLedger()).sequence;
  const authorize = createWalletAuthorizeEntry({
    signer: {kind: 'passkey', signer: createPasskeySigner(input.credential)},
    networkPassphrase: config.networkPassphrase,
    validUntilLedger: latestLedger + 120,
    reason: 'Move this wallet to this phone',
  });

  let signed;
  try {
    signed = await Promise.all(
      (simulation.result?.auth ?? []).map(entry =>
        authorize(entry, undefined, latestLedger + 120, config.networkPassphrase),
      ),
    );
  } catch (error) {
    if (error instanceof PasskeyError && error.code === 'USER_CANCELLED') {
      throw new WalletRecoveryError('CANCELLED', 'The prompt was dismissed.');
    }
    throw new WalletRecoveryError('ROTATION_FAILED', 'The passkey did not authorize the recovery.');
  }

  const authorized = new TransactionBuilder(await server.getAccount(relayer.address), {
    fee: '5000000',
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: call.body().invokeHostFunctionOp().hostFunction(),
        auth: signed,
      }),
    )
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(authorized);
  const {signedTxXdr} = await relayerSigner.signTransaction(prepared.toXDR());
  const sent = await server.sendTransaction(
    TransactionBuilder.fromXDR(signedTxXdr, config.networkPassphrase),
  );
  if (sent.status === 'ERROR') {
    throw new WalletRecoveryError('ROTATION_FAILED', 'The recovery was rejected by the network.');
  }
  const confirmed = await server.pollTransaction(sent.hash, {attempts: 30});
  if (confirmed.status !== 'SUCCESS') {
    throw new WalletRecoveryError('ROTATION_FAILED', 'The recovery did not confirm on Stellar.');
  }

  const wallet: SmartWallet = {
    contractId: input.walletContractId,
    devicePublicKey: identity.publicKey,
    recovery: input.credential,
  };
  useAppStore.getState().setSmartWallet(wallet);
  logger.info('wallet_recovered', {
    contractId: wallet.contractId,
    transactionHash: sent.hash,
  });
  return wallet;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
