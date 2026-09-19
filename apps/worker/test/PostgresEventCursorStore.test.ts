import {describe, expect, it} from 'vitest';
import {PostgresEventCursorStore, type PostgresCursorQueryClient} from '../src/PostgresEventCursorStore';

function fakeClient(row?: {cursor: string; start_ledger: number | string}) {
  const queries: Array<{text: string; values: readonly unknown[]}> = [];
  const client: PostgresCursorQueryClient & {queries: typeof queries} = {
    queries,
    async query<Row>(text: string, values: readonly unknown[] = []) {
      queries.push({text, values});
      if (text.startsWith('SELECT')) return {rows: row ? [row as Row] : []};
      return {rows: [] as Row[]};
    },
  };
  return client;
}

describe('Postgres event cursor store', () => {
  it('loads numeric PostgreSQL ledgers and upserts checkpoints', async () => {
    const client = fakeClient({cursor: 'cursor-4', start_ledger: '900'});
    const store = new PostgresEventCursorStore(client);

    await expect(store.load()).resolves.toEqual({cursor: 'cursor-4', startLedger: 900});
    await store.save({cursor: 'cursor-5', startLedger: 901});
    expect(client.queries[1]).toMatchObject({values: ['settlement_events', 'cursor-5', 901]});
    expect(client.queries[1]?.text).toContain('ON CONFLICT (name)');
  });

  it('rejects invalid persisted and outgoing checkpoints', async () => {
    await expect(new PostgresEventCursorStore(fakeClient({cursor: '', start_ledger: 1})).load()).rejects.toThrow('Invalid worker event cursor');
    await expect(new PostgresEventCursorStore(fakeClient()).save({cursor: ' ', startLedger: 1})).rejects.toThrow('must contain a cursor');
    await expect(new PostgresEventCursorStore(fakeClient()).save({cursor: 'cursor', startLedger: 0})).rejects.toThrow('positive ledger');
  });
});
