import {ApiClientError, RosaPayApiClient} from '../src/api/client';
import {defaultRetryPolicy, isRetryable, retryDelayMs} from '../src/api/retry';
import {mockSignedIntent} from '../src/features/payments/mockIntent';

const noSleep = () => Promise.resolve();

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('deciding what to send again', () => {
  it('retries a connection that never answered', () => {
    expect(isRetryable(new ApiClientError('NETWORK_ERROR', 'failed'))).toBe(true);
    expect(isRetryable(new ApiClientError('REQUEST_TIMEOUT', 'timed out'))).toBe(true);
  });

  it('retries a server that is struggling or asking us to wait', () => {
    expect(isRetryable(new ApiClientError('SERVER_ERROR', 'oops', 503))).toBe(true);
    expect(isRetryable(new ApiClientError('RATE_LIMITED', 'slow down', 429))).toBe(true);
  });

  it('never retries an answer the server actually gave', () => {
    // A malformed intent stays malformed; retrying only delays the message.
    expect(isRetryable(new ApiClientError('INVALID_INTENT', 'bad', 400))).toBe(false);
    expect(isRetryable(new ApiClientError('FORBIDDEN', 'no', 403))).toBe(false);
    expect(isRetryable(new ApiClientError('CONFLICT', 'used', 409))).toBe(false);
  });

  it('backs off further with each attempt', () => {
    expect(retryDelayMs(1)).toBe(defaultRetryPolicy.baseDelayMs);
    expect(retryDelayMs(2)).toBe(defaultRetryPolicy.baseDelayMs * 2);
    expect(retryDelayMs(3)).toBe(defaultRetryPolicy.baseDelayMs * 4);
  });
});

describe('an intent sent over a bad connection', () => {
  it('arrives once the network recovers', async () => {
    const fetcher = jest
      .fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(
        jsonResponse({payload: mockSignedIntent, payloadHash: 'a'.repeat(64), idempotencyKey: 'k'.repeat(16), status: 'created'}),
      );

    const client = new RosaPayApiClient({baseUrl: 'http://127.0.0.1:4100', fetcher, sleep: noSleep});
    const stored = await client.createPaymentIntent(mockSignedIntent, 'k'.repeat(16));

    expect(stored.payload).toEqual(mockSignedIntent);
    expect(fetcher).toHaveBeenCalledTimes(2);
    // The same idempotency key both times, which is what makes the repeat safe.
    const keys = fetcher.mock.calls.map(call => (call[1].headers as Record<string, string>)['idempotency-key']);
    expect(new Set(keys).size).toBe(1);
  });

  it('gives up after the policy runs out rather than retrying forever', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('connection reset'));
    const client = new RosaPayApiClient({baseUrl: 'http://127.0.0.1:4100', fetcher, sleep: noSleep});

    await expect(client.createPaymentIntent(mockSignedIntent, 'k'.repeat(16))).rejects.toThrow(ApiClientError);
    expect(fetcher).toHaveBeenCalledTimes(defaultRetryPolicy.attempts);
  });

  it('stops immediately when the server rejected the intent', async () => {
    const fetcher = jest
      .fn()
      .mockResolvedValue(jsonResponse({code: 'INVALID_INTENT', message: 'Amount is not canonical'}, 400));
    const client = new RosaPayApiClient({baseUrl: 'http://127.0.0.1:4100', fetcher, sleep: noSleep});

    await expect(client.createPaymentIntent(mockSignedIntent, 'k'.repeat(16))).rejects.toMatchObject({
      code: 'INVALID_INTENT',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('calls that spend money', () => {
  it('does not repeat a wallet deployment, which is rate limited and costly', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('connection reset'));
    const client = new RosaPayApiClient({baseUrl: 'http://127.0.0.1:4100', fetcher, sleep: noSleep});

    await expect(client.provisionWallet('BASE64KEY')).rejects.toThrow(ApiClientError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not repeat an on-chain merchant registration', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('connection reset'));
    const client = new RosaPayApiClient({baseUrl: 'http://127.0.0.1:4100', fetcher, sleep: noSleep});

    await expect(client.registerMerchantOnChain('profile-1')).rejects.toThrow(ApiClientError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
