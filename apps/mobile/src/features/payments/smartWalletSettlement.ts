import {Buffer} from 'buffer';
import {createNativeRosaPaySigner} from '../../native/nativeSigner';
import type {HardwareDigestSigner} from '@rosapay/stellar';
import {RosaPayApiClient} from '../../api';
import {ensureDeviceSession} from '../../api/deviceSession';
import {logger} from '../../shared/logger';
import {useAppStore, type SmartWallet} from '../../state/appStore';

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

  try {
    const provisioned = await client.provisionWallet(identity.publicKey);
    const wallet: SmartWallet = {
      contractId: provisioned.walletContractId,
      devicePublicKey: identity.publicKey,
    };
    store.setSmartWallet(wallet);
    logger.info('smart_wallet_provisioned', {
      contractId: wallet.contractId,
      fundedAmount: provisioned.fundedAmount,
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
