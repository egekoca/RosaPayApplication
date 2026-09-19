import {Buffer} from 'buffer';
import {useEffect, useRef} from 'react';
import {sign as signEd25519} from '@noble/ed25519';
import type {SignedPaymentIntentV1} from '@rosapay/protocol';
import {
  buildSettlementEnvelope,
  createSettlementClient,
  createStellarConfig,
} from '@rosapay/stellar';
import {ApiClientError, RosaPayApiClient} from '../../api';
import {logger} from '../../shared/logger';
import {useAppStore} from '../../state/appStore';
import type {MerchantProfile} from './merchantProfile';
import {ensureDeviceSession} from '../../api/deviceSession';

/**
 * Signs the contract digest for whichever customer has claimed this request.
 *
 * The settlement contract verifies a merchant signature over a digest that names
 * the payer, so it cannot be produced when the request is made — only once
 * someone has said they are paying it. This is the merchant's half of that
 * exchange, and it runs here because the merchant's signing key exists nowhere
 * else.
 */
export async function countersignClaimedRequest(input: {
  request: SignedPaymentIntentV1;
  profile: MerchantProfile;
  baseUrl: string;
  relayerAddress: string;
  settlementContractId: string;
}): Promise<{signed: boolean; customerAddress?: string}> {
  const client = new RosaPayApiClient({baseUrl: input.baseUrl});
  const intentId = input.request.intent.intentId;

  let claim;
  try {
    claim = await client.getCountersignature(intentId);
  } catch (error) {
    // Nobody has claimed it yet, which is the normal state of a request on
    // screen. Anything else is worth knowing about but not worth failing on.
    if (error instanceof ApiClientError && error.status === 404) return {signed: false};
    throw error;
  }
  if (claim.signature) return {signed: true, customerAddress: claim.customerAddress};

  const config = createStellarConfig('testnet', {settlementContractId: input.settlementContractId});
  const envelope = buildSettlementEnvelope(input.request.intent, {
    customer: claim.customerAddress,
    networkPassphrase: config.networkPassphrase,
    settlementContractId: input.settlementContractId,
  });
  const digestClient = createSettlementClient(config, {publicKey: input.relayerAddress});
  const digest = (await digestClient.intent_digest({intent: envelope.intent}, {simulate: true})).result;
  const signature = await signEd25519(Uint8Array.from(digest), input.profile.developmentSigningSecret);

  await ensureDeviceSession(client);
  await client.supplyCountersignature(intentId, claim.customerAddress, Buffer.from(signature).toString('base64'));
  return {signed: true, customerAddress: claim.customerAddress};
}

/**
 * Watches the request on screen and signs for a customer as soon as one claims
 * it, so the customer is not left holding an approval that cannot complete.
 */
export function useMerchantCountersigning(input: {
  request: SignedPaymentIntentV1 | null;
  profile: MerchantProfile | null;
  relayerAddress: string | undefined;
  settlementContractId: string | undefined;
  enabled: boolean;
  intervalMs?: number;
}): void {
  const baseUrl = useAppStore(state => state.apiBaseUrl);
  // One signing attempt at a time, so a slow simulation cannot stack up.
  const busy = useRef(false);
  const {request, profile, relayerAddress, settlementContractId, enabled, intervalMs = 2_000} = input;

  useEffect(() => {
    if (!enabled || !request || !profile || !relayerAddress || !settlementContractId) return;
    // Only the merchant that signed the request can countersign it.
    if (request.intent.merchantSigningKey !== profile.signingKey) return;

    let cancelled = false;
    const tick = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const result = await countersignClaimedRequest({
          request,
          profile,
          baseUrl,
          relayerAddress,
          settlementContractId,
        });
        if (result.signed && !cancelled) {
          logger.info('merchant_countersigned', {intentId: request.intent.intentId});
        }
      } catch (error) {
        logger.error('merchant_countersign_failed', {
          intentId: request.intent.intentId,
          message: error instanceof Error ? error.message : 'unknown error',
        });
      } finally {
        busy.current = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [baseUrl, enabled, intervalMs, profile, relayerAddress, request, settlementContractId]);
}
