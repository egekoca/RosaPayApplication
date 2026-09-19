import {NativeSecureSigner, type NativeSignerBridge} from '@rosapay/secure-signer';
import {createStellarConfig} from '@rosapay/stellar';
import {mockSignedIntent} from '../src/features/payments/mockIntent';
import {settlePaymentIntent} from '../src/features/payments/settlementAdapter';

describe('mobile settlement adapter', () => {
  it('does not enter Testnet settlement without the separate contract signature', async () => {
    const bridge: NativeSignerBridge = {
      async getIdentity() { return {signerId: 'device', publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', kind: 'passkey'}; },
      async createIdentity() { throw new Error('not used'); },
      async authorizePayment() { throw new Error('not used'); },
      async signAuthEntry() { return {signedAuthEntry: 'signed'}; },
      async signTransaction() { return {signedTxXdr: 'signed'}; },
    };

    await expect(settlePaymentIntent(mockSignedIntent, {
      mode: 'testnet',
      signer: new NativeSecureSigner(bridge),
      config: createStellarConfig('testnet'),
      latestLedger: 1_500_000,
      relayerSigner: {signTransaction: async xdr => ({signedTxXdr: xdr})},
    })).rejects.toMatchObject({name: 'SettlementServiceError', code: 'CONTRACT_SIGNATURE_REQUIRED'});
  });
});
