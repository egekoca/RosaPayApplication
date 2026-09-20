import {describe, expect, it} from 'vitest';
import {
  decodeOfflineSessionMessage,
  encodeOfflineSessionMessage,
  offlineSessionKindCode,
  offlineSessionKindOf,
} from '../src/offlineSession';

describe('the offline payment conversation', () => {
  it('names every message by the same byte at both ends', () => {
    for (const kind of ['request', 'payer', 'authRequest', 'authorization', 'result', 'decline'] as const) {
      expect(offlineSessionKindOf(offlineSessionKindCode(kind))).toBe(kind);
    }
  });

  it('does not answer for a dialect it has never heard', () => {
    // A later version of this protocol has to reach an older phone as silence
    // rather than as a message it half understands.
    expect(offlineSessionKindOf(0)).toBeNull();
    expect(offlineSessionKindOf(99)).toBeNull();
  });

  it('carries the payer, so the merchant can build what they will sign', () => {
    const encoded = encodeOfflineSessionMessage('payer', {
      v: 'RTP/1',
      intentId: 'intent-1',
      payer: 'CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L',
      account: 'smart-wallet',
    });
    expect(decodeOfflineSessionMessage('payer', encoded)).toEqual({
      v: 'RTP/1',
      intentId: 'intent-1',
      payer: 'CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L',
      account: 'smart-wallet',
    });
  });

  it('round-trips the entry to sign and the signature that comes back', () => {
    const offer = encodeOfflineSessionMessage('authRequest', {
      v: 'RTP/1',
      intentId: 'intent-1',
      networkPassphrase: 'Test SDF Network ; September 2015',
      settlementContractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
      entryXdr: 'AAAAAQ==',
      signatureExpirationLedger: 1_200,
      latestLedger: 1_080,
    });
    expect(decodeOfflineSessionMessage('authRequest', offer)?.signatureExpirationLedger).toBe(1_200);

    const answer = encodeOfflineSessionMessage('authorization', {
      v: 'RTP/1',
      intentId: 'intent-1',
      authorizer: 'CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L',
      signatureExpirationLedger: 1_200,
      entryXdr: 'AAAAAg==',
    });
    expect(decodeOfflineSessionMessage('authorization', answer)?.entryXdr).toBe('AAAAAg==');
  });

  it('reads nothing from noise, because a radio delivers plenty of it', () => {
    // Half a frame, a stale message and a scan of something else all arrive the
    // same way. None of them is an error worth stopping a payment over; the
    // answer to all three is to carry on waiting.
    expect(decodeOfflineSessionMessage('payer', 'not json')).toBeNull();
    expect(decodeOfflineSessionMessage('payer', '{"v":"RTP/2","intentId":"a","payer":"C","account":"smart-wallet"}')).toBeNull();
    expect(decodeOfflineSessionMessage('result', '{"v":"RTP/1","intentId":"a","status":"maybe"}')).toBeNull();
    expect(decodeOfflineSessionMessage('authRequest', `{"v":"RTP/1","x":"${'a'.repeat(20_000)}"}`)).toBeNull();
  });

  it('refuses to send a message it would not accept', () => {
    // Caught on the phone that built it, rather than becoming a silence on the
    // phone that was waiting for it.
    expect(() =>
      encodeOfflineSessionMessage('result', {
        v: 'RTP/1',
        intentId: 'intent-1',
        status: 'confirmed',
        ledger: -1,
      } as never),
    ).toThrow();
  });
});
