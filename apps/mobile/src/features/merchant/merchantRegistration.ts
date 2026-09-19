import {RosaPayApiClient} from '../../api';
import {useAppStore} from '../../state/appStore';
import {logger} from '../../shared/logger';
import type {MerchantProfile} from './merchantProfile';
import {ensureDeviceSession} from '../../api/deviceSession';

/**
 * Publishes the profile to the API and registers its signing key with the
 * settlement contract. Testnet settlement fails closed without this, because the
 * contract only accepts requests from a registered merchant.
 */
export async function registerMerchantForTestnet(
  profile: MerchantProfile,
  client: RosaPayApiClient = new RosaPayApiClient({baseUrl: useAppStore.getState().apiBaseUrl}),
): Promise<{transactionHash: string}> {
  await ensureDeviceSession(client);
  await client.createMerchantProfile({
    id: profile.merchantProfileId,
    displayName: profile.displayName,
    recipient: profile.recipient,
    signingKey: profile.signingKey,
    network: profile.network,
  });
  const registration = await client.registerMerchantOnChain(profile.merchantProfileId);
  logger.info('merchant_registered_on_chain', {
    merchantProfileId: profile.merchantProfileId,
    transactionHash: registration.transactionHash,
  });
  return {transactionHash: registration.transactionHash};
}
