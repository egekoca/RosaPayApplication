import {Buffer} from 'buffer';
import {createNativeRosaPaySigner} from '../../native/nativeSigner';
import type {HardwareDigestSigner} from '@rosapay/stellar';
import {RosaPayApiClient} from '../../api';
import {ensureDeviceSession} from '../../api/deviceSession';
import {logger} from '../../shared/logger';
import {useAppStore, type SmartWallet} from '../../state/appStore';
import {createPasskey, passkeysAvailable, PasskeyError} from '../wallet/passkey';

export class SmartWalletError extends Error {
  override readonly name = 'SmartWalletError';

  constructor(
    readonly code: 'DEVICE_KEY_MISSING' | 'WALLET_UNAVAILABLE',
    message: string,
  ) {
    super(message);
  }
}

/** Bridges the platform module into the shape the wallet signer expects. */
export function createHardwareDigestSigner(publicKey: string): HardwareDigestSigner {
  const signer = createNativeRosaPaySigner();
  return {
    publicKey,
    signDigest: request => signer.signDigest(request),
  };
}

/** Returns the device-controlled smart wallet, provisioning it on first use. */
export async function ensureSmartWallet(
  client: RosaPayApiClient = new RosaPayApiClient({baseUrl: useAppStore.getState().apiBaseUrl}),
): Promise<SmartWallet> {
  const store = useAppStore.getState();
  const signer = createNativeRosaPaySigner();

  let identity = await signer.getIdentity().catch(() => null);
  if (!identity?.publicKey) {
    identity = await signer.createIdentity('Lumenade Pay').catch(() => null);
  }
  if (!identity?.publicKey) {
    throw new SmartWalletError(
      'DEVICE_KEY_MISSING',
      'Set a screen lock on this phone so it can hold a payment key, then try again',
    );
  }

  try {
    await ensureDeviceSession(client);
  } catch (error) {
    throw new SmartWalletError(
      'WALLET_UNAVAILABLE',
      error instanceof Error ? error.message : 'The device session could not be created',
    );
  }

  const existing = useAppStore.getState().smartWallet;
  if (existing && existing.devicePublicKey === identity.publicKey) return existing;

  // A wallet is created with two keys or it is a wallet that dies with the
  // phone. The device key signs payments; the passkey exists so a lost handset
  // can be rotated out from a new one, because the platform syncs it and the
  // enclave key it replaces could never be copied anywhere.
  const recovery = await createRecoveryPasskey(identity.publicKey);

  try {
    const provisioned = await client.provisionWallet(
      identity.publicKey,
      recovery
        ? {publicKey: recovery.publicKey, credentialId: recovery.credentialId, kind: 'Passkey'}
        : undefined,
    );
    const wallet: SmartWallet = {
      contractId: provisioned.walletContractId,
      devicePublicKey: identity.publicKey,
      ...(recovery ? {recovery} : {}),
    };
    store.setSmartWallet(wallet);
    logger.info('smart_wallet_provisioned', {
      contractId: wallet.contractId,
      fundedAmount: provisioned.fundedAmount,
      recoverable: Boolean(recovery),
    });
    return wallet;
  } catch (error) {
    throw new SmartWalletError(
      'WALLET_UNAVAILABLE',
      error instanceof Error ? error.message : 'The smart wallet could not be created',
    );
  }
}

/** The digest a wallet signature covers is always exactly 32 bytes. */
export function assertAuthorizationDigest(payload: Buffer): void {
  if (payload.length !== 32) {
    throw new SmartWalletError('WALLET_UNAVAILABLE', 'The authorization payload is not a 32-byte digest');
  }
}

/**
 * The passkey that can rescue this wallet, or nothing if this phone cannot make
 * one.
 *
 * A device without passkey support still gets a wallet. Refusing to create one
 * would be the wrong trade: an account that works today and cannot be recovered
 * is worth more than no account, and the app says which it has rather than
 * implying a safety net that is not there. A cancelled prompt is treated the
 * same way - the customer chose, and setup carries on.
 */
async function createRecoveryPasskey(
  devicePublicKey: string,
): Promise<{credentialId: string; publicKey: string} | undefined> {
  if (!(await passkeysAvailable())) {
    logger.info('recovery_passkey_unavailable', {reason: 'unsupported'});
    return undefined;
  }
  try {
    // The user handle is derived from the device key rather than random, so the
    // same phone re-running setup presents the same account to the platform
    // instead of accumulating credentials.
    const userId = Uint8Array.from(
      Buffer.from(devicePublicKey, 'base64').subarray(1, 17),
    );
    return await createPasskey({userId, name: 'Lumenade Pay wallet'});
  } catch (error) {
    logger.info('recovery_passkey_unavailable', {
      reason: error instanceof PasskeyError ? error.code : 'failed',
    });
    return undefined;
  }
}
