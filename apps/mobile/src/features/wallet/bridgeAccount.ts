import {Keypair} from '@stellar/stellar-sdk';
import {logger} from '../../shared/logger';
import {bridgeFrom, type AnchorBridge} from './anchorBridge';
import {loadBridgeKey, saveBridgeKey} from './keyVault';
import {keypairFromSecret} from './stellarKey';

/**
 * The bridge key on this phone, made on first use.
 *
 * It is kept apart from `anchorBridge.ts` so that module stays free of the
 * platform keychain and can be exercised by the Testnet proof directly. The key
 * itself is not something the customer backs up: it holds nothing at rest, and
 * a lost one is replaced rather than recovered.
 */
export async function ensureBridgeAccount(): Promise<AnchorBridge> {
  const existing = await loadBridgeKey();
  if (existing) return bridgeFrom(keypairFromSecret(existing));

  const keypair = Keypair.random();
  await saveBridgeKey(keypair.secret());
  logger.info('anchor_bridge_created', {address: keypair.publicKey()});
  return bridgeFrom(keypair);
}
