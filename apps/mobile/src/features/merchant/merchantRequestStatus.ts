import {useQuery} from '@tanstack/react-query';
import {hashPaymentIntent, type SignedPaymentIntentV1} from '@rosapay/protocol';
import {RosaPayApiClient} from '../../api';
import {useAppStore} from '../../state/appStore';
import {logger} from '../../shared/logger';
import {fetchRelayerIdentity} from '../payments/testnetSettlement';
import {ensureDeviceSession} from '../../api/deviceSession';


function apiClient(): RosaPayApiClient {
  return new RosaPayApiClient({baseUrl: useAppStore.getState().apiBaseUrl});
}

/** Publishes the request so a customer's settlement has an intent to move. */
export async function publishPaymentRequest(request: SignedPaymentIntentV1): Promise<void> {
  try {
    const client = apiClient();
    await ensureDeviceSession(client);
    // The intent ID is unique per request, so it is also a stable idempotency key.
    const stored = await client.createPaymentIntent(request, `intent-${request.intent.intentId}`);
    if (
      stored.payload.signature !== request.signature ||
      hashPaymentIntent(stored.payload.intent) !== hashPaymentIntent(request.intent)
    ) {
      throw new Error('The API already has a different payment request with this ID');
    }
  } catch (error) {
    logger.error('payment_request_not_published', {
      intentId: request.intent.intentId,
      message: error instanceof Error ? error.message : 'unknown error',
    });
    throw error;
  }
}

/** Polls the settlement the API holds for this request. */
export function usePaymentRequestStatus(intentId: string) {
  return useQuery({
    queryKey: ['settlement', intentId],
    enabled: intentId.length > 0,
    queryFn: () => apiClient().getSettlement(intentId),
    refetchInterval: 5_000,
    retry: false,
  });
}

/** Every payment this merchant has been asked for, not only this device's. */
export function useMerchantPayments(merchantProfileId: string | undefined) {
  return useQuery({
    queryKey: ['merchant-payments', merchantProfileId],
    enabled: Boolean(merchantProfileId),
    queryFn: async () => {
      const client = apiClient();
      await ensureDeviceSession(client);
      return client.listMerchantPayments(merchantProfileId!);
    },
    refetchInterval: 15_000,
    retry: false,
  });
}

/**
 * The relayer this deployment uses. The merchant needs its address to simulate
 * the contract digest it has to countersign.
 */
export function useRelayerIdentity() {
  const apiBaseUrl = useAppStore(state => state.apiBaseUrl);
  return useQuery({
    queryKey: ['relayer', apiBaseUrl],
    queryFn: () => fetchRelayerIdentity(apiBaseUrl),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Whether the API is keeping records or holding them in memory. */
export function useApiHealth() {
  const apiBaseUrl = useAppStore(state => state.apiBaseUrl);
  return useQuery({
    queryKey: ['api-health', apiBaseUrl],
    queryFn: () => apiClient().health(),
    refetchInterval: 30_000,
    retry: false,
  });
}
