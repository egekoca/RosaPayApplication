import {afterEach, describe, expect, it} from 'vitest';
import {buildApp} from '../src/app';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(app => app.close())));

function signedIntent(intentId = '01K36YB37NXM4X4TECF0VKP1M9') {
  return {
    intent: {
      version: 'RTP/1',
      intentId,
      network: 'testnet',
      merchantProfileId: '01K36YATYFVQBPR08G2YT29C3S',
      merchantName: 'Rose Coffee',
      merchantSigningKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      recipient: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      asset: {type: 'native', code: 'XLM', decimals: 7},
      amount: '24.5',
      reference: 'Table 08',
      nonce: 'b9cdb790ee6a4d04a83763c018f532a8',
      expiresAtLedger: 1_500_120,
      createdAt: '2026-08-21T00:00:00.000Z',
    },
    signature: 'signed-intent-fixture',
  };
}

describe('API', () => {
  it('reports service health', async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject({method: 'GET', url: '/v1/health'});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({status: 'ok'});
  });

  it('validates intent input before persistence', async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: {'idempotency-key': '0123456789abcdef'},
      payload: {version: 'not-rtp'},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('INVALID_REQUEST');
  });

  it('creates, retrieves and idempotently retries payment intents', async () => {
    const app = buildApp();
    apps.push(app);
    const headers = {'idempotency-key': '0123456789abcdef'};
    const payload = signedIntent();

    const created = await app.inject({method: 'POST', url: '/v1/payment-intents', headers, payload});
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({payload, status: 'created'});
    expect(created.json().payloadHash).toMatch(/^[a-f0-9]{64}$/);

    const retried = await app.inject({method: 'POST', url: '/v1/payment-intents', headers, payload});
    expect(retried.statusCode).toBe(201);
    expect(retried.json()).toEqual(created.json());

    const fetched = await app.inject({
      method: 'GET',
      url: `/v1/payment-intents/${payload.intent.intentId}`,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual(created.json());
  });

  it('rejects intent ID reuse under a different idempotency key', async () => {
    const app = buildApp();
    apps.push(app);
    const payload = signedIntent();
    await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: {'idempotency-key': 'first-request-key'},
      payload,
    });

    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: {'idempotency-key': 'second-request-key'},
      payload,
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({code: 'INTENT_CONFLICT', message: 'Intent ID already exists'});
  });

  it('rejects an idempotency key reused for a different payload', async () => {
    const app = buildApp();
    apps.push(app);
    const headers = {'idempotency-key': 'one-request-key-1'};
    await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers,
      payload: signedIntent(),
    });

    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers,
      payload: signedIntent('01K36YB37NXM4X4TECF0VKP1MA'),
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({
      code: 'INTENT_CONFLICT',
      message: 'Idempotency key already used for a different intent',
    });
  });
});
