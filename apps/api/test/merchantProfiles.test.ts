import {afterEach, describe, expect, it} from 'vitest';
import {buildApp} from '../src/app';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(app => app.close())));

const profile = {
  id: '01K36YATYFVQBPR08G2YT29C3S',
  displayName: 'Rose Coffee',
  recipient: 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57',
  signingKey: 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57',
  network: 'testnet' as const,
};

function merchantAuth(userId = 'user-1') {
  return {required: true, resolve: async () => ({userId, capabilities: ['merchant'] as const})};
}

describe('merchant profiles', () => {
  it('creates and reads a profile in local anonymous mode', async () => {
    const app = buildApp();
    apps.push(app);

    const created = await app.inject({method: 'POST', url: '/v1/merchant-profiles', payload: profile});
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({...profile, status: 'active'});

    const fetched = await app.inject({method: 'GET', url: `/v1/merchant-profiles/${profile.id}`});
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({displayName: 'Rose Coffee', status: 'active'});
  });

  it('rejects a malformed receiving address before any customer can pay', async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/merchant-profiles',
      payload: {...profile, recipient: 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA58'},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({code: 'INVALID_MERCHANT_PROFILE'});
  });

  it('rejects a signing key that is not a Stellar G-address', async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/merchant-profiles',
      payload: {...profile, signingKey: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('G-address');
  });

  it('is idempotent for the same profile and conflicts on changed details', async () => {
    const app = buildApp();
    apps.push(app);

    await app.inject({method: 'POST', url: '/v1/merchant-profiles', payload: profile});
    const repeated = await app.inject({method: 'POST', url: '/v1/merchant-profiles', payload: profile});
    expect(repeated.statusCode).toBe(201);

    const changed = await app.inject({
      method: 'POST',
      url: '/v1/merchant-profiles',
      payload: {...profile, displayName: 'Rose Tea'},
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({code: 'MERCHANT_PROFILE_CONFLICT'});
  });

  it('returns 404 for an unknown profile', async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject({method: 'GET', url: '/v1/merchant-profiles/01K36YATYFVQBPR08G2YT29C3T'});
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({code: 'MERCHANT_PROFILE_NOT_FOUND'});
  });

  it('requires an authenticated merchant when auth is enforced', async () => {
    const app = buildApp({auth: {required: true}});
    apps.push(app);
    const response = await app.inject({method: 'POST', url: '/v1/merchant-profiles', payload: profile});
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({code: 'AUTHENTICATION_REQUIRED'});
  });

  it('rejects a customer-only session', async () => {
    const app = buildApp({
      auth: {required: true, resolve: async () => ({userId: 'user-1', capabilities: ['customer'] as const})},
    });
    apps.push(app);
    const response = await app.inject({method: 'POST', url: '/v1/merchant-profiles', payload: profile});
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({code: 'CAPABILITY_DENIED'});
  });

  it('keeps one merchant from reading another merchant profile', async () => {
    const owner = buildApp({auth: merchantAuth('user-1')});
    apps.push(owner);
    const created = await owner.inject({method: 'POST', url: '/v1/merchant-profiles', payload: profile});
    expect(created.json()).toMatchObject({userId: 'user-1'});

    const readBack = await owner.inject({method: 'GET', url: `/v1/merchant-profiles/${profile.id}`});
    expect(readBack.statusCode).toBe(200);
  });

  it('denies a profile owned by a different user', async () => {
    const repository = new (await import('../src/infrastructure/InMemoryMerchantProfileRepository')).InMemoryMerchantProfileRepository();
    const owner = buildApp({merchantProfiles: repository, auth: merchantAuth('user-1')});
    const other = buildApp({merchantProfiles: repository, auth: merchantAuth('user-2')});
    apps.push(owner, other);

    await owner.inject({method: 'POST', url: '/v1/merchant-profiles', payload: profile});
    const response = await other.inject({method: 'GET', url: `/v1/merchant-profiles/${profile.id}`});
    expect(response.statusCode).toBe(403);
    expect(response.json().message).toContain('not owned by the authenticated user');
  });
});
