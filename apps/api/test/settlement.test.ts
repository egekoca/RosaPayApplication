import {describe, expect, it} from 'vitest';
import {IntentService, SettlementInputError, SettlementTransitionError} from '../src/application/IntentService';
import {InMemoryIntentRepository} from '../src/infrastructure/InMemoryIntentRepository';

const payload = {
  intent: {
    version: 'RTP/1',
    intentId: '01K36YB37NXM4X4TECF0VKP1M9',
    network: 'testnet',
    merchantProfileId: '01K36YATYFVQBPR08G2YT29C3S',
    merchantName: 'Rose Coffee',
    merchantSigningKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    recipient: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    asset: {type: 'native', code: 'XLM', decimals: 7},
    amount: '1',
    reference: 'Table 08',
    nonce: 'b9cdb790ee6a4d04a83763c018f532a8',
    expiresAtLedger: 1_500_120,
    createdAt: '2026-08-21T00:00:00.000Z',
  },
  signature: 'fixture',
};

const hash = 'a'.repeat(64);

describe('settlement state service', () => {
  it('allows only the domain state-machine path and preserves receipt data', async () => {
    const service = new IntentService(new InMemoryIntentRepository());
    await service.create(payload, '0123456789abcdef');
    await service.authorize(payload.intent.intentId);
    await service.submit(payload.intent.intentId, hash);
    const confirmed = await service.confirm(payload.intent.intentId, hash, 123);

    expect(confirmed).toMatchObject({
      intentId: payload.intent.intentId,
      status: 'confirmed',
      transactionHash: hash,
      ledger: 123,
    });
  });

  it('rejects confirmation before submission and malformed receipt data', async () => {
    const service = new IntentService(new InMemoryIntentRepository());
    await service.create(payload, 'another-request-key');

    await expect(service.confirm(payload.intent.intentId, hash, 123)).rejects.toBeInstanceOf(SettlementTransitionError);
    await expect(service.submit(payload.intent.intentId, 'not-a-hash')).rejects.toBeInstanceOf(SettlementInputError);
  });

  it('makes repeated confirmation idempotent for the same transaction', async () => {
    const service = new IntentService(new InMemoryIntentRepository());
    await service.create(payload, 'idempotent-request-key');
    await service.authorize(payload.intent.intentId);
    await service.submit(payload.intent.intentId, hash);
    const first = await service.confirm(payload.intent.intentId, hash, 123);
    const second = await service.confirm(payload.intent.intentId, hash, 123);

    expect(second).toEqual(first);
  });

  it('exposes submitted settlements for worker reconciliation', async () => {
    const service = new IntentService(new InMemoryIntentRepository());
    await service.create(payload, 'worker-reconciliation-key');
    await service.authorize(payload.intent.intentId);
    await service.submit(payload.intent.intentId, hash);

    await expect(service.listSubmittedSettlements()).resolves.toEqual([
      expect.objectContaining({
        intentId: payload.intent.intentId,
        status: 'submitted',
        transactionHash: hash,
      }),
    ]);
  });

  it('allows only one concurrent terminal transition to win', async () => {
    const repository = new InMemoryIntentRepository();
    const service = new IntentService(repository);
    await service.create(payload, 'concurrent-terminal-key');
    await service.authorize(payload.intent.intentId);
    await service.submit(payload.intent.intentId, hash);

    const outcomes = await Promise.allSettled([
      service.confirm(payload.intent.intentId, hash, 123),
      service.fail(payload.intent.intentId, 'rpc_timeout'),
    ]);

    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    await expect(service.getSettlement(payload.intent.intentId)).resolves.toMatchObject({status: 'confirmed'});
  });
});
