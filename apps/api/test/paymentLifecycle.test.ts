import {afterEach, describe, expect, it} from 'vitest';
import {buildApp} from '../src/app';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(app => app.close())));

const customer = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const transactionHash = 'a'.repeat(64);
const authorizationHash = 'b'.repeat(64);

function signedIntent(intentId = '01K36YB37NXM4X4TECF0VKP1M9') {
  return {
    intent: {
      version: 'RTP/1',
      intentId,
      network: 'testnet',
      merchantProfileId: '01K36YATYFVQBPR08G2YT29C3S',
      merchantName: 'Rose Coffee',
      merchantSigningKey: customer,
      recipient: customer,
      asset: {type: 'native', code: 'XLM', decimals: 7},
      amount: '2.5',
      reference: 'Table 08',
      nonce: 'b9cdb790ee6a4d04a83763c018f532a8',
      expiresAtLedger: 1_500_120,
      createdAt: '2026-08-23T00:00:00.000Z',
    },
    signature: 'signed-intent-fixture',
  };
}

async function createIntent(app: ReturnType<typeof buildApp>, intentId?: string) {
  const payload = signedIntent(intentId);
  const created = await app.inject({
    method: 'POST',
    url: '/v1/payment-intents',
    headers: {'idempotency-key': `lifecycle-${payload.intent.intentId}`},
    payload,
  });
  expect(created.statusCode).toBe(201);
  return payload.intent.intentId;
}

describe('payment lifecycle', () => {
  it('records the authorization and the submitted transaction', async () => {
    const app = buildApp();
    apps.push(app);
    const intentId = await createIntent(app);

    const authorized = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/authorize`,
      payload: {authorizer: customer, authorizationHash, expiresAtLedger: 1_500_120},
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toMatchObject({status: 'authorized'});

    const record = await app.inject({method: 'GET', url: `/v1/payment-intents/${intentId}/authorization`});
    expect(record.json()).toMatchObject({authorizer: customer, authorizationHash, expiresAtLedger: 1_500_120});
    expect(record.json().receivedAt).toMatch(/^\d{4}-/);

    const submitted = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      payload: {transactionHash},
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toMatchObject({status: 'submitted', transactionHash});

    const settlement = await app.inject({method: 'GET', url: `/v1/payment-intents/${intentId}/settlement`});
    expect(settlement.json()).toMatchObject({status: 'submitted', transactionHash});
  });

  it('refuses to submit a payment that was never authorized', async () => {
    const app = buildApp();
    apps.push(app);
    const intentId = await createIntent(app);

    const response = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      payload: {transactionHash},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('INVALID_SETTLEMENT_TRANSITION');
  });

  it('rejects a malformed authorizer, hash and transaction hash', async () => {
    const app = buildApp();
    apps.push(app);
    const intentId = await createIntent(app);

    const badAuthorizer = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/authorize`,
      payload: {authorizer: 'not-an-address'},
    });
    expect(badAuthorizer.statusCode).toBe(400);

    const badHash = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/authorize`,
      payload: {authorizer: customer, authorizationHash: 'zz'},
    });
    expect(badHash.statusCode).toBe(400);

    await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/authorize`,
      payload: {authorizer: customer},
    });
    const badTx = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      payload: {transactionHash: 'nope'},
    });
    expect(badTx.statusCode).toBe(400);
  });

  it('keeps the same transaction hash when a submit is retried', async () => {
    const app = buildApp();
    apps.push(app);
    const intentId = await createIntent(app);
    await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/authorize`,
      payload: {authorizer: customer},
    });
    await app.inject({method: 'POST', url: `/v1/payment-intents/${intentId}/submit`, payload: {transactionHash}});

    const retry = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      payload: {transactionHash},
    });
    expect(retry.statusCode).toBe(200);

    const changed = await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      payload: {transactionHash: 'c'.repeat(64)},
    });
    expect(changed.statusCode).toBe(409);
  });

  it('requires a session for lifecycle mutations when auth is enforced', async () => {
    const app = buildApp({auth: {required: true}});
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/payment-intents/01K36YB37NXM4X4TECF0VKP1M9/authorize',
      payload: {authorizer: customer},
    });
    expect(response.statusCode).toBe(401);
  });

  it('reports 404 for an authorization that does not exist', async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject({method: 'GET', url: '/v1/payment-intents/unknown/authorization'});
    expect(response.statusCode).toBe(404);
  });
});

describe('merchant payment history', () => {
  it('lists what the merchant was asked to be paid and what happened', async () => {
    const app = buildApp();
    apps.push(app);
    const intentId = await createIntent(app);
    await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/authorize`,
      payload: {authorizer: customer},
    });
    await app.inject({method: 'POST', url: `/v1/payment-intents/${intentId}/submit`, payload: {transactionHash}});
    await app.inject({
      method: 'POST',
      url: '/v1/merchant-profiles',
      payload: {
        id: '01K36YATYFVQBPR08G2YT29C3S',
        displayName: 'Rose Coffee', email: 'hello@example.com',
        recipient: customer,
        signingKey: customer,
        network: 'testnet',
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/merchant-profiles/01K36YATYFVQBPR08G2YT29C3S/payments',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().payments).toEqual([
      expect.objectContaining({intentId, amount: '2.5', assetCode: 'XLM', status: 'submitted', transactionHash}),
    ]);
  });

  it('keeps one merchant from reading another merchant payment history', async () => {
    const repository = new (await import('../src/infrastructure/InMemoryMerchantProfileRepository'))
      .InMemoryMerchantProfileRepository();
    const owner = buildApp({
      merchantProfiles: repository,
      auth: {required: true, resolve: async () => ({userId: 'user-1', capabilities: ['merchant'] as const})},
    });
    const other = buildApp({
      merchantProfiles: repository,
      auth: {required: true, resolve: async () => ({userId: 'user-2', capabilities: ['merchant'] as const})},
    });
    apps.push(owner, other);

    await owner.inject({
      method: 'POST',
      url: '/v1/merchant-profiles',
      payload: {
        id: '01K36YATYFVQBPR08G2YT29C3S',
        displayName: 'Rose Coffee', email: 'hello@example.com',
        recipient: customer,
        signingKey: customer,
        network: 'testnet',
      },
    });

    const response = await other.inject({
      method: 'GET',
      url: '/v1/merchant-profiles/01K36YATYFVQBPR08G2YT29C3S/payments',
    });
    expect(response.statusCode).toBe(403);
  });
});
