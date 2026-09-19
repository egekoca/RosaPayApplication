import {afterEach, describe, expect, it, vi} from 'vitest';
import {StellarTransactionError} from '@rosapay/stellar';
import {
  confirmSubmittedSettlements,
  createConfirmationLoop,
  expireStaleSettlements,
  reconcileSettlementEventPage,
  reconcileSettlementEvents,
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

  it('reconciles matching contract events only after a matching RPC receipt', async () => {
    const state = stateFor([{intentId: 'intent-event', transactionHash: hash}]);
    const summary = await reconcileSettlementEvents({
      state,
      events: [
        {intentId: 'intent-event', transactionHash: hash, ledger: 77},
        {intentId: 'intent-event', transactionHash: hash, ledger: 77},
        {intentId: 'unknown', transactionHash: hash, ledger: 77},
      ],
      rpc: {confirmTransaction: async () => ({txHash: hash, ledger: 77})},
    });

    expect(summary).toEqual({scanned: 3, confirmed: 1, failed: 0, pending: 0, ignored: 2});
    expect(state.confirmed).toEqual([['intent-event', hash, 77]]);
  });

  it('fails events whose receipt or submitted hash does not match', async () => {
    const state = stateFor([
      {intentId: 'intent-hash', transactionHash: hash},
      {intentId: 'intent-receipt', transactionHash: hash},
    ]);
    let call = 0;
    const summary = await reconcileSettlementEvents({
      state,
      events: [
        {intentId: 'intent-hash', transactionHash: 'b'.repeat(64), ledger: 77},
        {intentId: 'intent-receipt', transactionHash: hash, ledger: 77},
      ],
      rpc: {
        confirmTransaction: async () => {
          call += 1;
          return {txHash: hash, ledger: call === 1 ? 76 : 77};
        },
      },
    });

    expect(summary).toEqual({scanned: 2, confirmed: 0, failed: 2, pending: 0, ignored: 0});
    expect(state.failed).toEqual([
      ['intent-hash', 'STELLAR_EVENT_TX_MISMATCH'],
      ['intent-receipt', 'STELLAR_EVENT_RECEIPT_MISMATCH'],
    ]);
  });

  it('loads and advances the event cursor after a page is reconciled', async () => {
    const state = stateFor([{intentId: 'intent-cursor', transactionHash: hash}]);
    const requested: Array<unknown> = [];
    const saved: Array<unknown> = [];
    const result = await reconcileSettlementEventPage({
      state,
      rpc: {confirmTransaction: async () => ({txHash: hash, ledger: 121})},
      source: {
        async getSettlementEvents(input) {
          requested.push(input);
          return {
            events: [{intentId: 'intent-cursor', transactionHash: hash, ledger: 121, eventId: 'event-1', merchantId: 'merchant', customer: 'customer', recipient: 'recipient', token: 'token', amount: '1'}],
            cursor: 'cursor-2',
            latestLedger: 121,
            oldestLedger: 100,
          };
        },
      },
      cursorStore: {
        async load() { return {cursor: 'cursor-1', startLedger: 100}; },
        async save(next) { saved.push(next); },
      },
      startLedger: 90,
      limit: 50,
    });

    expect(result).toMatchObject({confirmed: 1, cursor: 'cursor-2', latestLedger: 121});
    expect(requested).toEqual([{cursor: 'cursor-1', limit: 50}]);
    expect(saved).toEqual([{cursor: 'cursor-2', startLedger: 121}]);
  });

  it('does not advance the event cursor when fetching a page fails', async () => {
    const state = stateFor([]);
    const saved: Array<unknown> = [];
    await expect(reconcileSettlementEventPage({
      state,
      rpc: {confirmTransaction: async () => ({txHash: hash, ledger: 122})},
      source: {
        async getSettlementEvents() {
          throw new Error('temporary RPC outage');
        },
      },
      cursorStore: {
        async load() { return null; },
        async save(next) { saved.push(next); },
      },
      startLedger: 100,
    })).rejects.toThrow('temporary RPC outage');
    expect(saved).toEqual([]);
  });
});

describe('expiring settlements nobody completed', () => {
  function expiryState(rows: Array<{intentId: string; expiresAtLedger: number}>) {
    const expired: string[] = [];
    return {
      expired,
      async listSubmittedSettlements() {
        return [];
      },
      async confirm() {},
      async fail() {},
      async listExpiredSettlements() {
        return rows;
      },
      async expire(intentId: string) {
        expired.push(intentId);
      },
    };
  }

  it('expires a request whose ledger has passed', async () => {
    const state = expiryState([
      {intentId: 'intent-1', expiresAtLedger: 900},
      {intentId: 'intent-2', expiresAtLedger: 950},
    ]);

    const summary = await expireStaleSettlements({state, latestLedger: 1_000});

    expect(summary).toEqual({scanned: 2, expired: 2});
    expect(state.expired).toEqual(['intent-1', 'intent-2']);
  });

  it('leaves a request that is still within its window', async () => {
    const state = expiryState([{intentId: 'intent-1', expiresAtLedger: 1_200}]);

    const summary = await expireStaleSettlements({state, latestLedger: 1_000});

    expect(summary).toEqual({scanned: 1, expired: 0});
    expect(state.expired).toEqual([]);
  });

  it('does nothing when the state cannot report expiries', async () => {
    const summary = await expireStaleSettlements({
      state: {
        async listSubmittedSettlements() {
          return [];
        },
        async confirm() {},
        async fail() {},
      },
      latestLedger: 1_000,
    });

    expect(summary).toEqual({scanned: 0, expired: 0});
  });
});
