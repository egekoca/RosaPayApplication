import {signedPaymentIntentV1Schema} from '@rosapay/protocol';
import {z} from 'zod';

import {
  apiErrorResponseSchema,
  healthResponseSchema,
  merchantProfileSchema,
  merchantRegistrationSchema,
  storedIntentSchema,
} from './schemas';

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export type ApiClientOptions = {
  baseUrl: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
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

  constructor({baseUrl, fetcher = fetch, timeoutMs = 10_000}: ApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetcher = fetcher;
    this.timeoutMs = z.number().int().positive().parse(timeoutMs);
  }

  health() {
    return this.request('/v1/health', healthResponseSchema);
  }

  createPaymentIntent(payload: unknown, idempotencyKey: string) {
    const key = z.string().min(16).parse(idempotencyKey);
    const intent = signedPaymentIntentV1Schema.parse(payload);
    return this.request('/v1/payment-intents', storedIntentSchema, {
      method: 'POST',
      headers: {'content-type': 'application/json', 'idempotency-key': key},
      body: JSON.stringify(intent),
    });
  }

  createMerchantProfile(profile: {
    id: string;
    displayName: string;
    recipient: string;
    signingKey: string;
    network: 'testnet' | 'pubnet';
  }) {
    return this.request('/v1/merchant-profiles', merchantProfileSchema, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(profile),
    });
  }

  /** Registers the merchant on-chain so the settlement contract accepts its key. */
  registerMerchantOnChain(merchantProfileId: string) {
    const id = z.string().min(1).parse(merchantProfileId);
    // No body: sending a JSON content type without one makes Fastify reject it.
    return this.request(`/v1/merchant-profiles/${encodeURIComponent(id)}/registration`, merchantRegistrationSchema, {
      method: 'POST',
    });
  }

  getPaymentIntent(intentId: string) {
    const id = z.string().min(1).parse(intentId);
    return this.request(`/v1/payment-intents/${encodeURIComponent(id)}`, storedIntentSchema);
  }

  private async request<T>(path: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

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
