import {StrKey} from '@stellar/stellar-sdk';
import {Buffer} from 'buffer';
import {createSettlementClient, createStellarConfig} from '@rosapay/stellar';

describe('generated settlement client under the React Native transform', () => {
  it('exposes the contract methods the settlement flow calls', () => {
    const config = createStellarConfig('testnet', {
      settlementContractId: StrKey.encodeContract(Buffer.alloc(32, 5)),
    });
    const client = createSettlementClient(config, {publicKey: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 9))});

    expect(typeof (client as unknown as {intent_digest?: unknown}).intent_digest).toBe('function');
    expect(typeof (client as unknown as {settle_payment?: unknown}).settle_payment).toBe('function');
  });
});
