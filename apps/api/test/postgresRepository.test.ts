import {describe, expect, it} from 'vitest';
import {IntentService} from '../src/application/IntentService';
import {PostgresIntentRepository, type PostgresQueryClient} from '../src/infrastructure/PostgresIntentRepository';

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

function fakeClient(): PostgresQueryClient & {queries: Array<{text: string; values: readonly unknown[]}>} {
  const intents = new Map<string, Record<string, unknown>>();
  const settlements = new Map<string, Record<string, unknown>>();
  const queries: Array<{text: string; values: readonly unknown[]}> = [];
  return {
    queries,
    async query<Row>(text: string, values: readonly unknown[] = []) {
      queries.push({text, values});
      if (text.startsWith('INSERT INTO payment_intents')) {
        intents.set(String(values[0]), {
          intent_id: values[0],
          payload_hash: values[2],
          payload_json: values[3],
          status: values[4],
          idempotency_key: values[6],
        });
        return {rows: [] as Row[]};
      }
      if (text.includes('FROM payment_intents') && text.includes('WHERE idempotency_key')) {
        return {rows: [...intents.values()].filter(row => row.idempotency_key === values[0]) as Row[]};
      }
      if (text.includes('FROM payment_intents')) {
        return {rows: [...intents.values()].filter(row => row.intent_id === values[0]) as Row[]};
      }
      if (text.startsWith('INSERT INTO settlements')) {
        settlements.set(String(values[0]), {
          intent_id: values[0],
          tx_hash: values[1],
          ledger: values[2],
          status: values[3],
          failure_code: values[4],
          confirmed_at: values[5],
        });
        return {rows: [] as Row[]};
      }
      if (text.includes('FROM settlements') && text.includes('WHERE intent_id')) {
        return {rows: [...settlements.values()].filter(row => row.intent_id === values[0]) as Row[]};
      }
      if (text.includes('FROM settlements') && text.includes('WHERE status')) {
        return {rows: [...settlements.values()].filter(row => row.status === values[0]) as Row[]};
      }
      if (text.includes('FROM settlements')) return {rows: [...settlements.values()] as Row[]};
      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

describe('Postgres intent repository', () => {
  it('persists intent and settlement transitions through the repository port', async () => {
    const client = fakeClient();
    const service = new IntentService(new PostgresIntentRepository(client));
    const created = await service.create(payload, '0123456789abcdef');
    await service.authorize(payload.intent.intentId);
    await service.submit(payload.intent.intentId, hash);

    expect(await service.get(payload.intent.intentId)).toEqual(created);
    await expect(service.listSubmittedSettlements()).resolves.toMatchObject([
      {intentId: payload.intent.intentId, status: 'submitted', transactionHash: hash},
    ]);
    expect(client.queries.some(query => query.text.includes('INSERT INTO payment_intents'))).toBe(true);
    expect(client.queries.some(query => query.text.includes('ON CONFLICT (intent_id)'))).toBe(true);
  });

  it('maps PostgreSQL date and numeric representations into API records', async () => {
    const client = fakeClient();
    const repository = new PostgresIntentRepository(client);
    await repository.saveSettlement({
      intentId: payload.intent.intentId,
      status: 'confirmed',
      transactionHash: hash,
      ledger: 123,
      confirmedAt: '2026-08-22T00:00:00.000Z',
    });

    await expect(repository.findSettlement(payload.intent.intentId)).resolves.toEqual({
      intentId: payload.intent.intentId,
      status: 'confirmed',
      transactionHash: hash,
      ledger: 123,
      confirmedAt: '2026-08-22T00:00:00.000Z',
    });
  });
});
