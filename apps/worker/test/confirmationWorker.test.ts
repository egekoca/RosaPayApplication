import {afterEach, describe, expect, it, vi} from 'vitest';
import {StellarTransactionError} from '@rosapay/stellar';
import {
  confirmSubmittedSettlements,
  createConfirmationLoop,
  type SettlementConfirmationState,
} from '../src/confirmationWorker';

const hash = 'a'.repeat(64);

afterEach(() => vi.useRealTimers());

function stateFor(items: Array<{intentId: string; transactionHash: string}>): SettlementConfirmationState & {
  confirmed: Array<unknown>;
  failed: Array<unknown>;
} {
  const confirmed: Array<unknown> = [];
  const failed: Array<unknown> = [];
  return {
    confirmed,
    failed,
    async listSubmittedSettlements() {
      return items;
    },
    async confirm(...args) {
      confirmed.push(args);
    },
    async fail(...args) {
      failed.push(args);
    },
  };
}

describe('submitted settlement confirmation worker', () => {
  it('confirms receipts and preserves the receipt hash and ledger', async () => {
    const state = stateFor([{intentId: 'intent-1', transactionHash: hash}]);
    const summary = await confirmSubmittedSettlements({
      state,
      rpc: {confirmTransaction: async () => ({txHash: hash.toUpperCase(), ledger: 42})},
    });

    expect(summary).toEqual({scanned: 1, confirmed: 1, failed: 0, pending: 0});
    expect(state.confirmed).toEqual([['intent-1', hash.toUpperCase(), 42]]);
  });

  it('keeps not-found receipts pending for a later polling pass', async () => {
    const state = stateFor([{intentId: 'intent-2', transactionHash: hash}]);
    const summary = await confirmSubmittedSettlements({
      state,
      rpc: {
        confirmTransaction: async () => {
          throw new StellarTransactionError('NOT_FOUND', 'not indexed yet');
        },
      },
    });

    expect(summary).toEqual({scanned: 1, confirmed: 0, failed: 0, pending: 1});
    expect(state.failed).toHaveLength(0);
  });

  it('marks failed and invalid receipts as terminal failures', async () => {
    const state = stateFor([
      {intentId: 'intent-3', transactionHash: hash},
      {intentId: 'intent-4', transactionHash: hash},
    ]);
    let call = 0;
    const summary = await confirmSubmittedSettlements({
      state,
      rpc: {
        confirmTransaction: async () => {
          call += 1;
          if (call === 1) throw new StellarTransactionError('FAILED', 'failed on chain');
          return {txHash: 'b'.repeat(64), ledger: 43};
        },
      },
    });

    expect(summary).toEqual({scanned: 2, confirmed: 0, failed: 2, pending: 0});
    expect(state.failed).toEqual([
      ['intent-3', 'STELLAR_FAILED'],
      ['intent-4', 'STELLAR_INVALID_SUCCESS_RESPONSE'],
    ]);
  });

  it('starts immediately, skips overlapping cycles and stops cleanly', async () => {
    vi.useFakeTimers();
    let calls = 0;
    let release!: () => void;
    const firstCycle = new Promise<void>(resolve => {
      release = resolve;
    });
    const loop = createConfirmationLoop({
      intervalMs: 1_000,
      run: async () => {
        calls += 1;
        if (calls === 1) await firstCycle;
      },
    });

    loop.start();
    await Promise.resolve();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(calls).toBe(1);

    release();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);

    loop.stop();
    vi.advanceTimersByTime(2_000);
    expect(calls).toBe(2);
  });

  it('reports cycle errors without killing the loop', async () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
    let calls = 0;
    const loop = createConfirmationLoop({
      intervalMs: 100,
      run: async () => {
        calls += 1;
        if (calls === 1) throw new Error('temporary rpc outage');
      },
      onError: error => errors.push(error),
    });

    loop.start();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(2);
    expect(errors).toHaveLength(1);
    loop.stop();
  });
});
