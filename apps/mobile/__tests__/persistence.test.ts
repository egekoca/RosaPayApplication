import {Buffer} from 'buffer';
import {decodeSecrets, encodeSecrets} from '../src/state/persistence';

describe('session persistence', () => {
  it('round-trips signer secrets through JSON without losing bytes', () => {
    const state = {
      merchantProfile: {
        displayName: 'Rose Coffee',
        email: 'shop@example.com',
        developmentSigningSecret: Uint8Array.from([1, 2, 3, 250, 255]),
      },
      customerWallet: {publicKey: 'GABC', seed: Uint8Array.from(Buffer.alloc(32, 7)), funded: true},
      receipts: [{amount: '2.5'}],
    };

    const restored = decodeSecrets(JSON.parse(JSON.stringify(encodeSecrets(state)))) as typeof state;

    expect(restored.merchantProfile.email).toBe('shop@example.com');
    expect(restored.merchantProfile.developmentSigningSecret).toBeInstanceOf(Uint8Array);
    expect(Array.from(restored.merchantProfile.developmentSigningSecret)).toEqual([1, 2, 3, 250, 255]);
    expect(restored.customerWallet.seed).toHaveLength(32);
    expect(restored.customerWallet.publicKey).toBe('GABC');
    expect(restored.receipts).toEqual([{amount: '2.5'}]);
  });

  it('survives the reviver walking the object bottom-up', () => {
    const state = {
      merchantProfile: {developmentSigningSecret: Uint8Array.from(Buffer.alloc(32, 11))},
      nested: {deep: {seed: Uint8Array.from([9, 9])}},
    };

    const restored = JSON.parse(JSON.stringify(encodeSecrets(state)), (_key, value) => decodeSecrets(value)) as typeof state;

    expect(restored.merchantProfile.developmentSigningSecret).toBeInstanceOf(Uint8Array);
    expect(restored.merchantProfile.developmentSigningSecret).toHaveLength(32);
    expect(restored.nested.deep.seed).toBeInstanceOf(Uint8Array);
    expect(Array.from(restored.nested.deep.seed)).toEqual([9, 9]);
  });

  it('leaves ordinary values untouched', () => {
    expect(encodeSecrets({a: 1, b: 'two', c: null, d: [3, 'four']})).toEqual({a: 1, b: 'two', c: null, d: [3, 'four']});
    expect(decodeSecrets({a: 1, b: 'two'})).toEqual({a: 1, b: 'two'});
  });

  it('does not mistake a lookalike object for a secret', () => {
    expect(decodeSecrets({__bytes: 'not-hex!'})).toEqual({__bytes: 'not-hex!'});
  });
});
