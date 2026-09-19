import {useQuery} from '@tanstack/react-query';
import type {SignedPaymentIntentV1} from '@rosapay/protocol';
import {ApiClientError, RosaPayApiClient} from '../../api';
import {apiBaseUrl} from '../../shared/apiConfig';
import {logger} from '../../shared/logger';

const client = new RosaPayApiClient({baseUrl: apiBaseUrl});

/** Publishes the request so a customer's settlement has an intent to move. */
export async function publishPaymentRequest(request: SignedPaymentIntentV1): Promise<void> {
  try {
    // The intent ID is unique per request, so it is also a stable idempotency key.
    await client.createPaymentIntent(request, `intent-${request.intent.intentId}`);
  } catch (error) {
    if (error instanceof ApiClientError && error.code === 'INTENT_CONFLICT') return;
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
    queryFn: () => client.getSettlement(intentId),
    refetchInterval: 5_000,
    retry: false,
  });
}
