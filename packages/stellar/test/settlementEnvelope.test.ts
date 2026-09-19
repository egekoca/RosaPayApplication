import {Networks, StrKey} from '@stellar/stellar-sdk';
import {describe, expect, it} from 'vitest';

import {
  SettlementEnvelopeError,
  assetContractId,
  attachMerchantContractSignature,
  buildSettlementEnvelope,
  createSettlementClient,
  createStellarConfig,
  decimalToContractAmount,
  settlementIntentId,
  settlementMerchantId,
} from '../src';

const customer = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const settlementContractId = StrKey.encodeContract(Buffer.alloc(32, 5));

function paymentIntent() {
  return {
    version: 'RTP/1' as const,
    intentId: '01K36YB37NXM4X4TECF0VKP1M9',
    network: 'testnet' as const,
    merchantProfileId: '01K36YATYFVQBPR08G2YT29C3S',
    merchantName: 'Rose Coffee',
    merchantSigningKey: customer,
    recipient: customer,
    asset: {type: 'native' as const, code: 'XLM', decimals: 7},
    amount: '24.5',
    reference: 'Table 08',
    nonce: 'b9cdb790ee6a4d04a83763c018f532a8',
    expiresAtLedger: 1_500_120,
    createdAt: '2026-08-21T00:00:00.000Z',
  };
}

describe('settlement envelope', () => {
  it('maps an RTP/1 intent to exact contract-native types', () => {
    const source = paymentIntent();
    const envelope = buildSettlementEnvelope(source, {
      customer,
      networkPassphrase: Networks.TESTNET,
      settlementContractId,
    });

    expect(envelope.intent).toMatchObject({
      amount: 245_000_000n,
      customer,
      expires_at_ledger: source.expiresAtLedger,
      recipient: customer,
      settlement_contract: settlementContractId,
      token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    });
    expect(envelope.intent.network_id.toString('hex')).toBe(
      'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472',
    );
    expect(envelope.intent.intent_id).toEqual(settlementIntentId(source.intentId));
    expect(envelope.intent.merchant_id).toEqual(settlementMerchantId(source.merchantProfileId));
    expect(envelope.intent.intent_id).toHaveLength(32);
    expect(envelope.intent.nonce).toHaveLength(32);
    expect(envelope.rtpIntentHash).toHaveLength(32);
  });

  it('converts asset decimals without floating point rounding', () => {
    expect(decimalToContractAmount('0.0000001', 7)).toBe(1n);
    expect(decimalToContractAmount('999999999999999999.9999999', 7)).toBe(
      9_999_999_999_999_999_999_999_999n,
    );
    expect(() => decimalToContractAmount('1.00000001', 7)).toThrow('cannot be represented');
    expect(() => decimalToContractAmount('0', 7)).toThrow('outside the contract i128 range');
  });

  it('derives classic SAC IDs and preserves explicit SAC IDs', () => {
    const issuedAsset = {
      type: 'credit' as const,
      code: 'USDC',
      issuer: customer,
      decimals: 7,
    };
    expect(assetContractId(issuedAsset, Networks.TESTNET)).toMatch(/^C[A-Z2-7]{55}$/);

    const explicitContractId = StrKey.encodeContract(Buffer.alloc(32, 7));
    expect(
      assetContractId(
        {type: 'sac', code: 'USDC', contractId: explicitContractId, decimals: 7},
        Networks.TESTNET,
      ),
    ).toBe(explicitContractId);
  });

  it('rejects a network mismatch and malformed contract signature', () => {
    expect(() =>
      buildSettlementEnvelope(paymentIntent(), {
        customer,
        networkPassphrase: Networks.PUBLIC,
        settlementContractId,
      }),
    ).toThrowError(SettlementEnvelopeError);

    const envelope = buildSettlementEnvelope(paymentIntent(), {
      customer,
      networkPassphrase: Networks.TESTNET,
      settlementContractId,
    });
    expect(() => attachMerchantContractSignature(envelope, new Uint8Array(63))).toThrow(
      'must be 64 bytes',
    );
    expect(attachMerchantContractSignature(envelope, new Uint8Array(64)).merchantSignature).toHaveLength(64);
  });

  it('rejects values that cannot cross the generated contract boundary', () => {
    expect(() =>
      buildSettlementEnvelope({...paymentIntent(), expiresAtLedger: 0x1_0000_0000}, {
        customer,
        networkPassphrase: Networks.TESTNET,
        settlementContractId,
      }),
    ).toThrow('u32 range');
    expect(() =>
      assetContractId(
        {type: 'credit', code: 'NOT VALID', issuer: customer, decimals: 7},
        Networks.TESTNET,
      ),
    ).toThrow('cannot be represented');
  });
});

describe('generated settlement client', () => {
  it('uses the explicit deployment and network configuration', () => {
    const config = createStellarConfig('testnet', {settlementContractId});
    const client = createSettlementClient(config, {publicKey: customer});
    expect(client.options).toMatchObject({
      contractId: settlementContractId,
      networkPassphrase: Networks.TESTNET,
      publicKey: customer,
      rpcUrl: 'https://soroban-testnet.stellar.org',
    });

    const envelope = attachMerchantContractSignature(
      buildSettlementEnvelope(paymentIntent(), {
        customer,
        networkPassphrase: Networks.TESTNET,
        settlementContractId,
      }),
      new Uint8Array(64),
    );
    expect(
      client.spec.funcArgsToScVals('settle_payment', {
        intent: envelope.intent,
        merchant_signature: envelope.merchantSignature,
      }),
    ).toHaveLength(2);
  });

  it('cannot create a client before deployment is configured', () => {
    expect(() =>
      createSettlementClient(createStellarConfig('testnet', {settlementContractId: null})),
    ).toThrow(
      'deployed settlement contract ID is required',
    );
  });
});
