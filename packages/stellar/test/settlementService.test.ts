import {getPublicKey, hashes, sign} from '@noble/ed25519';
import {sha512} from '@noble/hashes/sha2.js';
import {Networks, StrKey} from '@stellar/stellar-sdk';
import {hashPaymentIntent} from '@rosapay/protocol';
import {describe, expect, it, vi} from 'vitest';
import {settleSignedPayment, SettlementServiceError, type SettlementPipelineClient} from '../src';

hashes.sha512 = sha512;

const customer = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const contractId = StrKey.encodeContract(Buffer.alloc(32, 5));
const merchantSecret = new Uint8Array(32).fill(7);

function unsignedPayload() {
  return {
    version: 'RTP/1' as const,
    intentId: '01K36YB37NXM4X4TECF0VKP1M9',
    network: 'testnet' as const,
    merchantProfileId: '01K36YATYFVQBPR08G2YT29C3S',
    merchantName: 'Rose Coffee',
    merchantSigningKey: '',
    recipient: customer,
    asset: {type: 'native' as const, code: 'XLM', decimals: 7},
    amount: '1',
    reference: 'Table 08',
    nonce: 'b9cdb790ee6a4d04a83763c018f532a8',
    expiresAtLedger: 1_500_120,
    createdAt: '2026-08-21T00:00:00.000Z',
  };
}

async function signedPayload() {
  const intent = {...unsignedPayload(), merchantSigningKey: StrKey.encodeEd25519PublicKey(Buffer.from(await getPublicKey(merchantSecret)))};
  const signature = await sign(Buffer.from(hashPaymentIntent(intent), 'hex'), merchantSecret);
  return {intent, signature: Buffer.from(signature).toString('base64')};
}

function config() {
  return {
    network: 'testnet' as const,
    networkPassphrase: Networks.TESTNET,
    rpcUrl: 'https://rpc',
    horizonUrl: 'https://horizon',
    friendbotUrl: null,
    settlementContractId: contractId,
  };
}

describe('settlement service', () => {
  it('rejects an invalid RTP merchant signature before simulation', async () => {
    const client = {settle_payment: vi.fn()} as unknown as SettlementPipelineClient;
    const payload = {intent: {...unsignedPayload(), merchantSigningKey: customer}, signature: 'invalid'};

    await expect(settleSignedPayment({
      payload,
      config: config(),
      customerAddress: customer,
      latestLedger: 1_500_000,
      merchantContractSignature: new Uint8Array(64),
      customerSigner: {signAuthEntry: vi.fn()},
      relayerSigner: {signTransaction: vi.fn()},
      client,
    })).rejects.toMatchObject({code: 'INVALID_MERCHANT_SIGNATURE'});
    expect(client.settle_payment).not.toHaveBeenCalled();
  });

  it('requires the contract digest signature separately from RTP/1', async () => {
    const payload = await signedPayload();

    await expect(settleSignedPayment({
      payload,
      config: config(),
      customerAddress: customer,
      latestLedger: 1_500_000,
      merchantContractSignature: new Uint8Array(),
      customerSigner: {signAuthEntry: vi.fn()},
      relayerSigner: {signTransaction: vi.fn()},
    })).rejects.toMatchObject({code: 'CONTRACT_SIGNATURE_REQUIRED'});
  });
});
