import {xdr} from '@stellar/stellar-sdk';
import {Buffer} from 'buffer';
import {describe, expect, it, vi} from 'vitest';
import {createSettlementContractSpec, createStellarConfig} from '../src';
import {StellarRpcClient, StellarTransactionError} from '../src/rpc';

const hash = 'a'.repeat(64);

describe('Stellar RPC confirmation guard', () => {
  it('accepts only a successful transaction with a ledger', async () => {
    const client = new StellarRpcClient(createStellarConfig('testnet'));
    vi.spyOn(client.server, 'pollTransaction').mockResolvedValue({
      status: 'SUCCESS',
      txHash: hash,
      ledger: 123,
    } as never);

    await expect(client.confirmTransaction(hash)).resolves.toEqual({txHash: hash, ledger: 123});
  });

  it('rejects not-found and failed results', async () => {
    const client = new StellarRpcClient(createStellarConfig('testnet'));
    vi.spyOn(client.server, 'pollTransaction').mockResolvedValueOnce({status: 'NOT_FOUND', txHash: hash} as never);
    await expect(client.confirmTransaction(hash)).rejects.toMatchObject({code: 'NOT_FOUND'});

    vi.spyOn(client.server, 'pollTransaction').mockResolvedValueOnce({status: 'FAILED', txHash: hash} as never);
    await expect(client.confirmTransaction(hash)).rejects.toMatchObject({code: 'FAILED'});
  });

  it('rejects malformed hashes before touching RPC', async () => {
    const client = new StellarRpcClient(createStellarConfig('testnet'));
    const poll = vi.spyOn(client.server, 'pollTransaction');
    await expect(client.confirmTransaction('short')).rejects.toBeInstanceOf(StellarTransactionError);
    expect(poll).not.toHaveBeenCalled();
  });

  it('queries and decodes successful PaymentSettled contract events with the generated spec', async () => {
    const config = createStellarConfig('testnet');
    if (!config.settlementContractId) throw new Error('test fixture requires a settlement contract');
    const client = new StellarRpcClient(config);
    const spec = createSettlementContractSpec(config);
    const intentId = Buffer.alloc(32, 0x11);
    const merchantId = Buffer.alloc(32, 0x22);
    const customer = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const recipient = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const token = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
    const event = spec.findEvent('PaymentSettled');
    if (!event) throw new Error('PaymentSettled event missing from generated spec');
    const eventData = {customer, recipient, token, amount: 250_000n};
    const data = xdr.ScVal.scvMap(event.params()
      .filter(param => param.location().value === xdr.ScSpecEventParamLocationV0.scSpecEventParamLocationData().value)
      .map(param => new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol(param.name().toString()),
        val: spec.nativeToScVal(eventData[param.name().toString() as keyof typeof eventData], param.type()),
      })));
    const eventFilter = spec.eventTopicFilter('PaymentSettled');
    const topics = [
      xdr.ScVal.fromXDR(eventFilter[0]!, 'base64'),
      xdr.ScVal.scvBytes(intentId),
      xdr.ScVal.scvBytes(merchantId),
    ];
    vi.spyOn(client.server, 'getEvents').mockResolvedValue({
      events: [{
        id: 'event-1',
        txHash: 'a'.repeat(64),
        ledger: 123,
        ledgerClosedAt: '2026-08-22T00:00:00Z',
        transactionIndex: 0,
        operationIndex: 0,
        inSuccessfulContractCall: true,
        type: 'contract',
        contractId: {toString: () => config.settlementContractId},
        topic: topics,
        value: data,
      }],
      cursor: 'cursor-1',
      latestLedger: 130,
      oldestLedger: 100,
      latestLedgerCloseTime: '2026-08-22T00:00:00Z',
      oldestLedgerCloseTime: '2026-08-21T23:59:00Z',
    } as never);

    const page = await client.getSettlementEvents({startLedger: 100, endLedger: 130, limit: 10});

    expect(client.server.getEvents).toHaveBeenCalledWith(expect.objectContaining({
      startLedger: 100,
      endLedger: 130,
      limit: 10,
      filters: [{
        type: 'contract',
        contractIds: [config.settlementContractId],
        topics: [spec.eventTopicFilter('PaymentSettled')],
      }],
    }));
    expect(page).toMatchObject({cursor: 'cursor-1', latestLedger: 130, oldestLedger: 100});
    expect(page.events[0]).toMatchObject({
      eventId: 'event-1',
      transactionHash: 'a'.repeat(64),
      ledger: 123,
      intentId: '11'.repeat(32),
      merchantId: '22'.repeat(32),
      customer,
      recipient,
      token,
      amount: '250000',
    });
  });

  it('rejects invalid event ranges before touching RPC', async () => {
    const client = new StellarRpcClient(createStellarConfig('testnet'));
    const getEvents = vi.spyOn(client.server, 'getEvents');

    await expect(client.getSettlementEvents({startLedger: 0})).rejects.toMatchObject({code: 'INVALID_LEDGER_RANGE'});
    expect(getEvents).not.toHaveBeenCalled();
  });

  it('passes a persisted event cursor to RPC pagination', async () => {
    const client = new StellarRpcClient(createStellarConfig('testnet'));
    const getEvents = vi.spyOn(client.server, 'getEvents').mockResolvedValue({
      events: [],
      cursor: 'cursor-2',
      latestLedger: 140,
      oldestLedger: 100,
      latestLedgerCloseTime: '2026-08-22T00:00:00Z',
      oldestLedgerCloseTime: '2026-08-21T23:59:00Z',
    } as never);

    await client.getSettlementEvents({cursor: 'cursor-1', limit: 10});
    expect(getEvents.mock.calls[0]?.[0]).toMatchObject({cursor: 'cursor-1', limit: 10});
  });
});
