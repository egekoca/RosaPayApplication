import {signedPaymentIntentV1Schema} from '@rosapay/protocol';
import {z} from 'zod';

import {defaultRetryPolicy, isRetryable, retryDelayMs, type RetryPolicy} from './retry';
import {
  apiErrorResponseSchema,
  healthResponseSchema,
  merchantProfileSchema,
  merchantPaymentsSchema,
  merchantRegistrationSchema,
  provisionedWalletSchema,
  settlementRecordSchema,
  storedIntentSchema,
} from './schemas';

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type ApiClientOptions = {
  baseUrl: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  /** Injected so tests do not have to wait out the backoff. */
  sleep?: (ms: number) => Promise<void>;
};

export type ApiClientErrorCode =
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'REQUEST_TIMEOUT'
  | string;

export class ApiClientError extends Error {
  constructor(
    public readonly code: ApiClientErrorCode,
    message: string,
    public readonly status: number | null = null,
    public readonly issues?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function normalizeBaseUrl(input: string): string {
  const url = z.string().url().parse(input);
  if (!/^https?:\/\//.test(url)) {
    throw new Error('API base URL must use HTTP or HTTPS');
  }
  return url.replace(/\/$/, '');
}

export class RosaPayApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly retryPolicy: RetryPolicy;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor({
    baseUrl,
    fetcher = fetch,
    timeoutMs = 10_000,
    retryPolicy = defaultRetryPolicy,
    sleep = ms => new Promise<void>(resolve => setTimeout(resolve, ms)),
  }: ApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetcher = fetcher;
    this.timeoutMs = z.number().int().positive().parse(timeoutMs);
    this.retryPolicy = retryPolicy;
    this.sleep = sleep;
  }

  health() {
    return this.request('/v1/health', healthResponseSchema, {}, this.timeoutMs, true);
  }

  createPaymentIntent(payload: unknown, idempotencyKey: string) {
    const key = z.string().min(16).parse(idempotencyKey);
    const intent = signedPaymentIntentV1Schema.parse(payload);
    return this.request('/v1/payment-intents', storedIntentSchema, {
      method: 'POST',
      headers: {'content-type': 'application/json', 'idempotency-key': key},
      body: JSON.stringify(intent),
    }, this.timeoutMs, true);
  }

  createMerchantProfile(profile: {
    id: string;
    displayName: string;
    recipient: string;
    signingKey: string;
    network: 'testnet' | 'pubnet';
  }) {
    // The server keys a profile by its ID and returns the existing one when the
    // details match, so a repeat is the same profile rather than a second one.
    return this.request('/v1/merchant-profiles', merchantProfileSchema, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(profile),
    }, this.timeoutMs, true);
  }

  /**
   * Registers the merchant on-chain so the settlement contract accepts its key.
   * Deliberately not retried: every attempt is a real transaction the admin pays
   * for, and the endpoint is rate limited, so a retry storm would spend the
   * budget on a call the merchant can simply make again.
   */
  registerMerchantOnChain(merchantProfileId: string) {
    const id = z.string().min(1).parse(merchantProfileId);
    // No body: sending a JSON content type without one makes Fastify reject it.
    return this.request(`/v1/merchant-profiles/${encodeURIComponent(id)}/registration`, merchantRegistrationSchema, {
      method: 'POST',
    });
  }

  getPaymentIntent(intentId: string) {
    const id = z.string().min(1).parse(intentId);
    return this.request(`/v1/payment-intents/${encodeURIComponent(id)}`, storedIntentSchema, {}, this.timeoutMs, true);
  }

  /** Records who authorized the payment before it is submitted. */
  authorizePayment(intentId: string, authorization: {authorizer: string; authorizationHash?: string; expiresAtLedger?: number}) {
    const id = z.string().min(1).parse(intentId);
    return this.request(`/v1/payment-intents/${encodeURIComponent(id)}/authorize`, settlementRecordSchema, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(authorization),
    }, this.timeoutMs, true);
  }

  /** Records the transaction the relayer sent, so the worker can reconcile it. */
  submitPayment(intentId: string, transactionHash: string) {
    const id = z.string().min(1).parse(intentId);
    return this.request(`/v1/payment-intents/${encodeURIComponent(id)}/submit`, settlementRecordSchema, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({transactionHash}),
    }, this.timeoutMs, true);
  }

  /** Deploys and funds a smart wallet controlled by this device's key. */
  provisionWallet(devicePublicKey: string) {
    // Deploying and funding a wallet is two Testnet transactions, so this call
    // legitimately takes far longer than a normal request. It is not retried:
    // the endpoint allows three calls an hour, and spending that budget on a
    // request that may already have deployed a wallet would strand the device.
    return this.request(
      '/v1/wallets',
      provisionedWalletSchema,
      {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({devicePublicKey}),
      },
      90_000,
    );
  }

  /** What this merchant has been asked to be paid, across every device. */
  listMerchantPayments(merchantProfileId: string) {
    const id = z.string().min(1).parse(merchantProfileId);
    return this.request(`/v1/merchant-profiles/${encodeURIComponent(id)}/payments`, merchantPaymentsSchema, {}, this.timeoutMs, true);
  }

  getSettlement(intentId: string) {
    const id = z.string().min(1).parse(intentId);
    return this.request(`/v1/payment-intents/${encodeURIComponent(id)}/settlement`, settlementRecordSchema, {}, this.timeoutMs, true);
  }

  /**
   * Sends a request, trying again when the failure was the network rather than
   * the server's answer.
   *
   * Only calls marked `retryable` are repeated. Every one of them is idempotent
   * on the server — an intent by its idempotency key, a profile by its ID, a
   * settlement transition that returns the current state when it is already
   * there — so a request that in fact arrived before the connection dropped
   * produces the same result rather than a second payment.
   */
  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
    timeoutMs: number = this.timeoutMs,
    retryable = false,
  ): Promise<T> {
    const attempts = retryable ? this.retryPolicy.attempts : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await this.attempt(path, schema, init, timeoutMs);
      } catch (error) {
        lastError = error;
        if (attempt === attempts || !isRetryable(error)) throw error;
        await this.sleep(retryDelayMs(attempt, this.retryPolicy));
      }
    }

    throw lastError;
  }

  private async attempt<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        headers: {accept: 'application/json', ...init.headers},
        signal: controller.signal,
      });
      const body = await this.readJson(response);

      if (!response.ok) {
        const error = apiErrorResponseSchema.safeParse(body);
        if (error.success) {
          throw new ApiClientError(error.data.code, error.data.message, response.status, error.data.issues);
        }
        throw new ApiClientError('INVALID_RESPONSE', 'API returned an invalid error response', response.status);
      }

      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw new ApiClientError('INVALID_RESPONSE', 'API returned an invalid response', response.status);
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw new ApiClientError('REQUEST_TIMEOUT', 'API request timed out');
      }
      throw new ApiClientError('NETWORK_ERROR', 'API request failed');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new ApiClientError('INVALID_RESPONSE', 'API returned a non-JSON response', response.status);
    }
  }
}
