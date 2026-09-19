import {RosaPayApiClient, ApiClientError} from '../src/api';
import {mockSignedIntent} from '../src/features/payments/mockIntent';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    json: jest.fn().mockResolvedValue(body),
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

function storedIntent() {
  return {
    payload: mockSignedIntent,
    payloadHash: 'a'.repeat(64),
    idempotencyKey: '0123456789abcdef',
    status: 'created' as const,
  };
}

describe('RosaPayApiClient', () => {
  it('creates and validates a signed payment intent', async () => {
    const fetcher = jest.fn().mockResolvedValue(jsonResponse(storedIntent(), 201));
    const client = new RosaPayApiClient({baseUrl: 'http://127.0.0.1:4100/', fetcher});

    await expect(client.createPaymentIntent(mockSignedIntent, '0123456789abcdef')).resolves.toEqual(
      storedIntent(),
    );
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/v1/payment-intents',
      expect.objectContaining({
        body: JSON.stringify(mockSignedIntent),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'idempotency-key': '0123456789abcdef',
        },
        method: 'POST',
      }),
    );
  });

  it('encodes intent IDs used in request paths', async () => {
    const fetcher = jest.fn().mockResolvedValue(jsonResponse(storedIntent()));
    const client = new RosaPayApiClient({baseUrl: 'https://api.example.com', fetcher});

    await client.getPaymentIntent('intent/with spaces');
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/v1/payment-intents/intent%2Fwith%20spaces',
      expect.any(Object),
    );
  });

  it('preserves stable API error codes without exposing response payloads', async () => {
    const fetcher = jest.fn().mockResolvedValue(
      jsonResponse({code: 'INTENT_NOT_FOUND', message: 'Payment intent not found'}, 404),
    );
    const client = new RosaPayApiClient({baseUrl: 'https://api.example.com', fetcher});

    await expect(client.getPaymentIntent('missing')).rejects.toMatchObject({
      code: 'INTENT_NOT_FOUND',
      message: 'Payment intent not found',
      status: 404,
    });
  });

  it('rejects malformed successful responses', async () => {
    const fetcher = jest.fn().mockResolvedValue(jsonResponse({status: 'created'}));
    const client = new RosaPayApiClient({baseUrl: 'https://api.example.com', fetcher});

    await expect(client.getPaymentIntent('intent-1')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects invalid outbound intents before making a request', async () => {
    const fetcher = jest.fn();
    const client = new RosaPayApiClient({baseUrl: 'https://api.example.com', fetcher});

    expect(() => client.createPaymentIntent({version: 'not-rtp'}, '0123456789abcdef')).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports request timeouts separately from network failures', async () => {
    const fetcher = jest.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    );
    const client = new RosaPayApiClient({baseUrl: 'https://api.example.com', fetcher, timeoutMs: 1});

    await expect(client.health()).rejects.toEqual(
      expect.objectContaining<Partial<ApiClientError>>({code: 'REQUEST_TIMEOUT'}),
    );
  });
});
