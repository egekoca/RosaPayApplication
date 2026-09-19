import {describe, expect, it, vi} from 'vitest';

import {
  SettlementPipelineError,
  settlePayment,
  type SettlementPipelineClient,
  type SettlementPipelineTransaction,
} from '../src';

const intent = {
  amount: 1n,
  customer: 'C-CUSTOMER',
  expires_at_ledger: 42,
  intent_id: Buffer.alloc(32, 1),
  merchant_id: Buffer.alloc(32, 2),
  network_id: Buffer.alloc(32, 3),
  nonce: Buffer.alloc(32, 4),
  recipient: 'G-RECIPIENT',
  settlement_contract: 'C-CONTRACT',
  token: 'C-TOKEN',
};

function makeTransaction(overrides: Partial<SettlementPipelineTransaction> = {}): SettlementPipelineTransaction {
  return {
    result: undefined,
    needsNonInvokerSigningBy: () => ['C-CUSTOMER'],
    signAuthEntries: vi.fn(async () => undefined),
    signAndSend: vi.fn(async () => ({
      result: undefined,
      sendTransactionResponse: {status: 'PENDING', hash: 'submitted-hash'},
      getTransactionResponse: {status: 'SUCCESS', txHash: 'confirmed-hash', ledger: 123},
    })),
    ...overrides,
  };
}

function makeClient(transaction: SettlementPipelineTransaction): SettlementPipelineClient {
  return {settle_payment: vi.fn(async () => transaction)};
}

describe('settlement pipeline', () => {
  it('simulates, authorizes the customer entry, and confirms the relayed transaction', async () => {
    const transaction = makeTransaction();
    const customerSigner = {signAuthEntry: vi.fn(async authEntry => ({signedAuthEntry: `signed:${authEntry}`}))};
    const relayerSigner = {signTransaction: vi.fn(async xdr => ({signedTxXdr: xdr}))};
    const stages: string[] = [];

    const receipt = await settlePayment({
      client: makeClient(transaction),
      intent,
      merchantSignature: Buffer.alloc(64),
      customerSigner,
      relayerSigner,
      onProgress: progress => stages.push(progress.stage),
    });

    expect(receipt).toEqual({transactionHash: 'confirmed-hash', ledger: 123, result: undefined});
    expect(stages).toEqual(['simulated', 'authorized', 'submitted', 'confirmed']);
    expect(transaction.signAuthEntries).toHaveBeenCalledWith(expect.objectContaining({address: 'C-CUSTOMER'}));
    expect(transaction.signAndSend).toHaveBeenCalledOnce();
  });

  it('fails closed if simulation has no customer auth entry', async () => {
    const transaction = makeTransaction({needsNonInvokerSigningBy: () => []});

    await expect(
      settlePayment({
        client: makeClient(transaction),
        intent,
        merchantSignature: Buffer.alloc(64),
        customerSigner: {signAuthEntry: vi.fn()},
        relayerSigner: {signTransaction: vi.fn()},
      }),
    ).rejects.toMatchObject({code: 'CUSTOMER_AUTH_REQUIRED'});
    expect(transaction.signAndSend).not.toHaveBeenCalled();
  });

  it('rejects a transaction that was submitted but not confirmed', async () => {
    const transaction = makeTransaction({
      signAndSend: vi.fn(async () => ({
        result: undefined,
        sendTransactionResponse: {status: 'PENDING', hash: 'submitted-hash'},
        getTransactionResponse: {status: 'FAILED', txHash: 'failed-hash', ledger: 124},
      })),
    });

    await expect(
      settlePayment({
        client: makeClient(transaction),
        intent,
        merchantSignature: Buffer.alloc(64),
        customerSigner: {signAuthEntry: vi.fn()},
        relayerSigner: {signTransaction: vi.fn()},
      }),
    ).rejects.toMatchObject({code: 'CONFIRMATION_FAILED'});
  });
});
