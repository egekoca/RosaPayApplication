import {describe, expect, it} from 'vitest';
import type {PostgresQueryClient} from '@rosapay/postgres';
import {PostgresSettlementState, SettlementStateError} from '../src/PostgresSettlementState';

const txHash = 'a'.repeat(64);

function fakeClient(rows: Array<{intent_id: string; status: string; tx_hash: string | null}>, options: {updateRows?: number} = {}) {
  const statements: Array<{text: string; values: readonly unknown[]}> = [];
  const client: PostgresQueryClient & {statements: typeof statements} = {
    statements,
    async query<Row>(text: string, values: readonly unknown[] = []) {
      statements.push({text, values});
      if (text.trimStart().startsWith('SELECT')) {
        const intentId = values[0];
        const matching = intentId === undefined ? rows : rows.filter(row => row.intent_id === intentId);
        return {rows: matching as Row[]};
      }
      const updated = options.updateRows ?? 1;
      return {rows: Array.from({length: updated}, () => ({intent_id: 'intent-1'})) as Row[]};
    },
  };
  return client;
}

describe('Postgres settlement state', () => {
  it('lists submitted settlements with a valid transaction hash', async () => {
    const state = new PostgresSettlementState(fakeClient([{intent_id: 'intent-1', status: 'submitted', tx_hash: txHash}]));
    await expect(state.listSubmittedSettlements()).resolves.toEqual([{intentId: 'intent-1', transactionHash: txHash}]);
  });

  it('rejects a stored transaction hash that is not hexadecimal', async () => {
    const state = new PostgresSettlementState(fakeClient([{intent_id: 'intent-1', status: 'submitted', tx_hash: 'not-a-hash'}]));
    await expect(state.listSubmittedSettlements()).rejects.toBeInstanceOf(SettlementStateError);
  });

  it('confirms a submitted settlement only while it is still submitted', async () => {
    const client = fakeClient([{intent_id: 'intent-1', status: 'submitted', tx_hash: txHash}]);
    const state = new PostgresSettlementState(client);

    await state.confirm('intent-1', txHash, 900);
    const update = client.statements[1];
    expect(update?.text).toContain("status = 'confirmed'");
    expect(update?.values).toEqual(['intent-1', txHash, 900, 'submitted']);
  });

  it('treats a repeated confirmation of the same transaction as a no-op', async () => {
    const client = fakeClient([{intent_id: 'intent-1', status: 'confirmed', tx_hash: txHash}]);
    await new PostgresSettlementState(client).confirm('intent-1', txHash, 900);
    expect(client.statements).toHaveLength(1);
  });

  it('refuses to confirm a different transaction hash or an invalid ledger', async () => {
    const state = new PostgresSettlementState(fakeClient([{intent_id: 'intent-1', status: 'submitted', tx_hash: txHash}]));
    await expect(state.confirm('intent-1', 'b'.repeat(64), 900)).rejects.toThrow('cannot change its transaction hash');
    await expect(state.confirm('intent-1', txHash, 0)).rejects.toThrow('positive ledger');
    await expect(state.confirm('intent-1', 'zz', 900)).rejects.toThrow('hexadecimal');
  });

  it('refuses a transition the domain does not allow', async () => {
    const state = new PostgresSettlementState(fakeClient([{intent_id: 'intent-1', status: 'awaiting_approval', tx_hash: null}]));
    await expect(state.confirm('intent-1', txHash, 900)).rejects.toThrow('Cannot transition awaiting_approval to confirmed');
  });

  it('fails a submitted settlement and rejects an empty failure code', async () => {
    const client = fakeClient([{intent_id: 'intent-1', status: 'submitted', tx_hash: txHash}]);
    const state = new PostgresSettlementState(client);

    await state.fail('intent-1', ' STELLAR_FAILED ');
    expect(client.statements[1]?.values).toEqual(['intent-1', 'STELLAR_FAILED', 'submitted']);
    await expect(state.fail('intent-1', '  ')).rejects.toThrow('failure code is required');
  });

  it('detects a concurrent write that changed the row mid-cycle', async () => {
    const client = fakeClient([{intent_id: 'intent-1', status: 'submitted', tx_hash: txHash}], {updateRows: 0});
    await expect(new PostgresSettlementState(client).confirm('intent-1', txHash, 900))
      .rejects.toThrow('changed while it was being reconciled');
  });

  it('rejects an unknown settlement and an unknown stored status', async () => {
    await expect(new PostgresSettlementState(fakeClient([])).fail('missing', 'CODE')).rejects.toThrow('was not found');
    await expect(new PostgresSettlementState(fakeClient([{intent_id: 'intent-1', status: 'weird', tx_hash: null}])).fail('intent-1', 'CODE'))
      .rejects.toThrow('Unexpected settlement status');
  });
});
