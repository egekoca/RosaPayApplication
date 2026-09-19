import {RosaPayApiClient} from '../../api';
import {apiBaseUrl} from '../../shared/apiConfig';
import {logger} from '../../shared/logger';
import type {MerchantProfile} from './merchantProfile';

/**
 * Publishes the profile to the API and registers its signing key with the
 * settlement contract. Testnet settlement fails closed without this, because the
 * contract only accepts requests from a registered merchant.
 */
export async function registerMerchantForTestnet(
  profile: MerchantProfile,
  client: RosaPayApiClient = new RosaPayApiClient({baseUrl: apiBaseUrl}),
): Promise<{transactionHash: string}> {
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
