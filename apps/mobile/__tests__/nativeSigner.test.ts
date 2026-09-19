import {createNativeRosaPaySigner} from '../src/native/nativeSigner';

describe('native Rosa Pay signer adapter', () => {
  it('maps native signer methods to the secure signer port', async () => {
    const signer = createNativeRosaPaySigner({
      async getIdentity() { return {signerId: 'device-1', publicKey: 'CACCOUNT', kind: 'passkey'}; },
      async createIdentity() { return {signerId: 'device-1', publicKey: 'CACCOUNT', kind: 'passkey'}; },
      async deleteIdentity() {},
      async authorizePayment() { return {signerId: 'device-1', authorization: 'opaque', authorizedAt: '2026-08-22T00:00:00.000Z'}; },
      async signTransaction(request) { return {signedTxXdr: `signed:${request.xdr}`}; },
      async signDigest() {
      return {signerId: 'device', signature: 'ZGVy', signedAt: '2026-08-23T00:00:00.000Z'};
    },
    async signAuthEntry(request) { return {signedAuthEntry: `signed:${request.authEntry}`}; },
    });

    await expect(signer.getIdentity()).resolves.toMatchObject({publicKey: 'CACCOUNT'});
    await expect(signer.signAuthEntry({authEntry: 'auth', networkPassphrase: 'testnet'})).resolves.toEqual({signedAuthEntry: 'signed:auth'});
    await expect(signer.signTransaction({xdr: 'tx', networkPassphrase: 'testnet'})).resolves.toEqual({signedTxXdr: 'signed:tx'});
  });

  it('fails closed when the native module is absent', async () => {
    const signer = createNativeRosaPaySigner(null);
    await expect(signer.getIdentity()).rejects.toMatchObject({name: 'SecureSignerError', code: 'UNAVAILABLE'});
    await expect(signer.signAuthEntry({authEntry: 'auth', networkPassphrase: 'testnet'})).rejects.toMatchObject({name: 'SecureSignerError', code: 'UNAVAILABLE'});
  });
});
