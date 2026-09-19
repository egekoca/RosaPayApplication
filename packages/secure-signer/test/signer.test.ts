import {describe, expect, it} from 'vitest';
import {createStellarSignerCallbacks, NativeSecureSigner, SecureSignerError, type NativeSignerBridge} from '../src';

describe('native secure signer boundary', () => {
  it('returns only opaque authorization material to JavaScript', async () => {
    const bridge: NativeSignerBridge = {
      async getIdentity() {
        return {signerId: 'native-1', publicKey: 'public-only', kind: 'device-key'};
      },
      async createIdentity() {
        return {signerId: 'native-1', publicKey: 'public-only', kind: 'device-key'};
      },
      async authorizePayment(request) {
        return {signerId: 'native-1', authorization: `opaque:${request.intentHash}`, authorizedAt: '2026-08-21T00:00:00.000Z'};
      },
    };
    const signer = new NativeSecureSigner(bridge);
    const authorization = await signer.authorizePayment({
      intentId: 'intent-1',
      intentHash: 'a'.repeat(64),
      network: 'testnet',
      settlementContractId: 'CSETTLEMENT',
    });
    expect(authorization.authorization).toBe(`opaque:${'a'.repeat(64)}`);
    expect(authorization).not.toHaveProperty('privateKey');
  });

  it('passes Stellar SDK signer payloads through without exposing key material', async () => {
    const bridge: NativeSignerBridge = {
      async getIdentity() {
        return {signerId: 'native-1', publicKey: 'CACCOUNT', kind: 'passkey'};
      },
      async createIdentity() {
        return {signerId: 'native-1', publicKey: 'CACCOUNT', kind: 'passkey'};
      },
      async authorizePayment() {
        return {signerId: 'native-1', authorization: 'opaque', authorizedAt: '2026-08-21T00:00:00.000Z'};
      },
      async signAuthEntry(request) {
        return {signedAuthEntry: `signed:${request.authEntry}`, signerAddress: request.address};
      },
      async signTransaction(request) {
        return {signedTxXdr: `signed:${request.xdr}`, signerAddress: request.address};
      },
    };
    const signer = new NativeSecureSigner(bridge);

    await expect(signer.signAuthEntry({authEntry: 'auth-xdr', networkPassphrase: 'testnet'})).resolves.toEqual({
      signedAuthEntry: 'signed:auth-xdr',
      signerAddress: undefined,
    });
    await expect(signer.signTransaction({xdr: 'tx-xdr', networkPassphrase: 'testnet'})).resolves.toEqual({
      signedTxXdr: 'signed:tx-xdr',
      signerAddress: undefined,
    });
  });

  it('fails closed when a native bridge has no signing capability', async () => {
    const bridge: NativeSignerBridge = {
      async getIdentity() { return null; },
      async createIdentity() { throw new SecureSignerError('UNAVAILABLE', 'Passkeys unavailable'); },
      async authorizePayment() { throw new SecureSignerError('USER_CANCELLED', 'Approval cancelled'); },
    };
    const signer = new NativeSecureSigner(bridge);

    await expect(signer.signAuthEntry({authEntry: 'auth-xdr', networkPassphrase: 'testnet'})).rejects.toMatchObject({
      name: 'SecureSignerError',
      code: 'UNAVAILABLE',
    });
  });

  it('adapts native methods to Stellar callback shapes without exposing keys', async () => {
    const bridge: NativeSignerBridge = {
      async getIdentity() { return null; },
      async createIdentity() { return {signerId: 'device', publicKey: 'C...', kind: 'passkey'}; },
      async authorizePayment() { throw new SecureSignerError('USER_CANCELLED', 'cancelled'); },
      async signAuthEntry(request) { return {signedAuthEntry: `signed:${request.authEntry}`, signerAddress: request.address}; },
      async signTransaction(request) { return {signedTxXdr: `signed:${request.xdr}`, signerAddress: request.address}; },
    };
    const signer = new NativeSecureSigner(bridge);
    const callbacks = createStellarSignerCallbacks(signer);

    await expect(callbacks.signAuthEntry('auth-xdr', {networkPassphrase: 'testnet', address: 'C...'})).resolves.toEqual({
      signedAuthEntry: 'signed:auth-xdr',
      signerAddress: 'C...',
    });
    await expect(callbacks.signTransaction('tx-xdr', {networkPassphrase: 'testnet'})).resolves.toEqual({
      signedTxXdr: 'signed:tx-xdr',
      signerAddress: undefined,
    });
  });
});
