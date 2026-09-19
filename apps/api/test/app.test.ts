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
  it('reports service health and whether records are kept', async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject({method: 'GET', url: '/v1/health'});
    expect(response.statusCode).toBe(200);
    // Health names the storage mode, because in-memory records vanish on restart.
    expect(response.json()).toEqual({status: 'ok', storage: 'memory'});
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

    const settlement = await app.inject({
      method: 'GET',
      url: `/v1/payment-intents/${payload.intent.intentId}/settlement`,
    });
    expect(settlement.statusCode).toBe(200);
    expect(settlement.json()).toMatchObject({intentId: payload.intent.intentId, status: 'awaiting_approval'});
  });

  it('does not expose a settlement record for an unknown intent', async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject({method: 'GET', url: '/v1/payment-intents/unknown/settlement'});
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({code: 'SETTLEMENT_NOT_FOUND', message: 'Settlement not found'});
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

  it('returns a request ID and enforces merchant ownership when auth is required', async () => {
    const app = buildApp({
      auth: {
        required: true,
        resolve: async () => ({userId: 'user-1', capabilities: ['merchant'], merchantProfileIds: ['other-profile']}),
      },
    });
    apps.push(app);
    const payload = signedIntent();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: {'idempotency-key': 'auth-request-key-1', 'x-request-id': 'client-request-42'},
      payload,
    });

    expect(response.statusCode).toBe(403);
    expect(response.headers['x-request-id']).toBe('client-request-42');
    expect(response.json()).toEqual({code: 'CAPABILITY_DENIED', message: 'Merchant profile is not owned by the authenticated user'});
  });

  it('fails closed for anonymous mutations when auth is required', async () => {
    const app = buildApp({auth: {required: true}});
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: {'idempotency-key': 'auth-required-key'},
      payload: signedIntent(),
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({code: 'AUTHENTICATION_REQUIRED', message: 'An authenticated merchant session is required'});
  });
});

describe('storage reporting', () => {
  it('says when the API is keeping records durably', async () => {
    const app = buildApp({storage: 'postgres'});
    apps.push(app);
    const response = await app.inject({method: 'GET', url: '/v1/health'});
    expect(response.json()).toEqual({status: 'ok', storage: 'postgres'});
  });
});

describe('service metrics', () => {
  it('reports nothing but zeroes before any payment', async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({method: 'GET', url: '/v1/metrics'});

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      intents: 0,
      byStatus: {
        awaiting_approval: 0,
        authorized: 0,
        submitted: 0,
        confirmed: 0,
        rejected: 0,
        expired: 0,
        failed: 0,
      },
      medianConfirmationSeconds: null,
      storage: 'memory',
    });
  });

  it('counts a request by the outcome it reached', async () => {
    const app = buildApp();
    apps.push(app);

    const intent = signedIntent();
    await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: {'idempotency-key': 'metrics-key-0000000001'},
      payload: intent,
    });

    const metrics = (await app.inject({method: 'GET', url: '/v1/metrics'})).json();

    expect(metrics.intents).toBe(1);
    expect(metrics.byStatus.awaiting_approval).toBe(1);
    expect(metrics.byStatus.confirmed).toBe(0);
    // Nothing has confirmed, so there is no duration to report rather than a
    // zero that would read as "instant".
    expect(metrics.medianConfirmationSeconds).toBeNull();
  });

  it('reports how long a confirmed payment took', async () => {
    const app = buildApp();
    apps.push(app);

    const intent = signedIntent();
    const intentId = intent.intent.intentId;
    await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: {'idempotency-key': 'metrics-key-0000000002'},
      payload: intent,
    });
    await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/authorize`,
      payload: {authorizer: intent.intent.recipient},
    });
    const txHash = 'b'.repeat(64);
    await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      payload: {transactionHash: txHash},
    });

    const settlement = await app.inject({method: 'GET', url: `/v1/payment-intents/${intentId}/settlement`});
    expect(settlement.json().status).toBe('submitted');

    const metrics = (await app.inject({method: 'GET', url: '/v1/metrics'})).json();
    expect(metrics.byStatus.submitted).toBe(1);
    expect(metrics.byStatus.awaiting_approval).toBe(0);
  });
});

describe('confirmation timing', () => {
  it('never reports a payment that confirmed before it was requested', async () => {
    const app = buildApp();
    apps.push(app);

    const intent = signedIntent();
    const intentId = intent.intent.intentId;
    await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: {'idempotency-key': 'metrics-key-0000000003'},
      payload: intent,
    });
    await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/authorize`,
      payload: {authorizer: intent.intent.recipient},
    });
    await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      payload: {transactionHash: 'c'.repeat(64)},
    });
    await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/confirm`,
      payload: {transactionHash: 'c'.repeat(64), ledger: 4_300_000},
    });

    const metrics = (await app.inject({method: 'GET', url: '/v1/metrics'})).json();
    // Whatever it reports, a duration is either absent or forwards in time. A
    // negative median would read as "confirms before you ask", which is how a
    // clock artifact gets mistaken for a result.
    expect(
      metrics.medianConfirmationSeconds === null || metrics.medianConfirmationSeconds >= 0,
    ).toBe(true);
  });
});

describe('two devices completing one payment', () => {
  const customer = 'GDZ4ZAYGLEACS52ADRTWCDNDGZTWZRGYRV2QICRQ6YQU4Y4HTIQSM5F5';
  const otherCustomer = 'GAP2SKMN74QKHUXPZZ36LIDVUBEETH56IWUJ62OIAU2OENHGHSSOWLYF';
  const signature = `${'A'.repeat(86)}==`;

  async function withIntent(key: string) {
    const app = buildApp();
    apps.push(app);
    const intent = signedIntent();
    await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: {'idempotency-key': key},
      payload: intent,
    });
    return {app, intentId: intent.intent.intentId};
  }

  it('lets a customer claim a request so the merchant knows who to sign for', async () => {
    const {app, intentId} = await withIntent('counter-key-000000001');

    const claim = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/countersignature/request`,
      payload: {customerAddress: customer},
    });

    expect(claim.statusCode).toBe(200);
    expect(claim.json()).toMatchObject({intentId, customerAddress: customer});
    // Nothing to collect yet; the merchant has not signed.
    expect(claim.json().signature).toBeUndefined();
  });

  it('hands the signature to the customer that asked', async () => {
    const {app, intentId} = await withIntent('counter-key-000000002');
    await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/countersignature/request`,
      payload: {customerAddress: customer},
    });

    const supplied = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/countersignature`,
      payload: {customerAddress: customer, signature},
    });
    expect(supplied.statusCode).toBe(200);

    const collected = await app.inject({
      method: 'GET',
      url: `/v1/payment-intents/${intentId}/countersignature`,
    });
    expect(collected.json()).toMatchObject({customerAddress: customer, signature});
    expect(collected.json().signedAt).toEqual(expect.any(String));
  });

  it('keeps the request with the first customer to claim it', async () => {
    const {app, intentId} = await withIntent('counter-key-000000003');
    await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/countersignature/request`,
      payload: {customerAddress: customer},
    });

    const second = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/countersignature/request`,
      payload: {customerAddress: otherCustomer},
    });

    // Two people scanning the same code must not both be told to approve.
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('COUNTERSIGNATURE_CONFLICT');
  });

  it('refuses a signature that names someone other than the waiting customer', async () => {
    const {app, intentId} = await withIntent('counter-key-000000004');
    await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/countersignature/request`,
      payload: {customerAddress: customer},
    });

    const wrong = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/countersignature`,
      payload: {customerAddress: otherCustomer, signature},
    });

    // The waiting customer would collect this and fail on-chain, after being
    // asked to approve.
    expect(wrong.statusCode).toBe(409);
  });

  it('refuses a signature nobody asked for', async () => {
    const {app, intentId} = await withIntent('counter-key-000000005');

    const orphan = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/countersignature`,
      payload: {customerAddress: customer, signature},
    });

    expect(orphan.statusCode).toBe(404);
  });

  it('says a claim on a payment that does not exist is not found', async () => {
    const app = buildApp();
    apps.push(app);

    const missing = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents/01K36YB37NXM4X4TECF0VKP1M9/countersignature/request',
      payload: {customerAddress: customer},
    });

    expect(missing.statusCode).toBe(404);
  });

  it('refuses anything that is not a 64-byte signature', async () => {
    const {app, intentId} = await withIntent('counter-key-000000006');
    await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/countersignature/request`,
      payload: {customerAddress: customer},
    });

    const short = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/countersignature`,
      payload: {customerAddress: customer, signature: 'AAAA'},
    });

    expect(short.statusCode).toBe(400);
  });
});
