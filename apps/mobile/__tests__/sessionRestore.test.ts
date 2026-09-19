import {hasRestorableSession} from '../src/state/appStore';

describe('session restoration', () => {
  it('treats a wallet, a business profile or past receipts as a session to return to', () => {
    expect(hasRestorableSession({merchantProfile: null, receipts: []})).toBe(false);
    expect(
      hasRestorableSession({
        wallet: {address: 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6', origin: 'created' as const},
        merchantProfile: null,
        receipts: [],
      }),
    ).toBe(true);
    expect(
      hasRestorableSession({
        merchantProfile: null,
        receipts: [{intentId: 'a'} as never],
      }),
    ).toBe(true);
  });
});

describe('unusable restored secrets', () => {
  const {dropUnusableSecrets} = require('../src/state/appStore');
  const usableSecret = Uint8Array.from(Buffer.alloc(32, 5));

  it('keeps a profile whose signer bytes survived storage', () => {
    const profile = {displayName: 'Rose Coffee', developmentSigningSecret: usableSecret};
    const restored = dropUnusableSecrets({mode: 'merchant', merchantProfile: profile, receipts: []});

    expect(restored.merchantProfile).toBe(profile);
    expect(restored.mode).toBe('merchant');
  });

  it('drops a profile whose signer bytes did not survive, and leaves merchant mode', () => {
    const restored = dropUnusableSecrets({
      mode: 'merchant',
      merchantProfile: {displayName: 'Rose Coffee', developmentSigningSecret: {0: 1, 1: 2}},
      merchantRegisteredOnChain: true,
      pendingRequest: {intent: {}},
      receipts: [],
    });

    expect(restored.merchantProfile).toBeNull();
    expect(restored.mode).toBe('customer');
    expect(restored.merchantRegisteredOnChain).toBe(false);
    expect(restored.pendingRequest).toBeNull();
  });
});
