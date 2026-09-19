import {describe, expect, it} from 'vitest';
import type {SettlementEventPage} from '@rosapay/stellar';
import {createWorkerCycle, readWorkerConfig, WorkerConfigError} from '../src/runtime';
import type {SettlementConfirmationState, SubmittedSettlement} from '../src/confirmationWorker';

const txHash = 'c'.repeat(64);

function fakeState(submitted: SubmittedSettlement[]) {
  const confirmed: Array<{intentId: string; ledger: number}> = [];
  const state: SettlementConfirmationState & {confirmed: typeof confirmed} = {
    confirmed,
    async listSubmittedSettlements() {
      return submitted;
    },
    async confirm(intentId, _transactionHash, ledger) {
      confirmed.push({intentId, ledger});
    },
    async fail() {},
  };
  return state;
}

describe('worker configuration', () => {
  it('defaults the interval and leaves event scanning off', () => {
    expect(readWorkerConfig({})).toEqual({intervalMs: 10_000});
  });

  it('reads the interval, start ledger and page limit', () => {
    expect(readWorkerConfig({WORKER_INTERVAL_MS: '2500', WORKER_EVENT_START_LEDGER: '900', WORKER_EVENT_LIMIT: '50'}))
      .toEqual({intervalMs: 2500, eventStartLedger: 900, eventLimit: 50});
  });

  it('rejects non-positive settings', () => {
    expect(() => readWorkerConfig({WORKER_INTERVAL_MS: '0'})).toThrow(WorkerConfigError);
    expect(() => readWorkerConfig({WORKER_EVENT_START_LEDGER: 'soon'})).toThrow('must be a positive integer');
  });
});

describe('worker cycle', () => {
  it('reconciles receipts and skips event scanning until a start ledger is configured', async () => {
    const state = fakeState([{intentId: 'intent-1', transactionHash: txHash}]);
    const logs: Array<Record<string, unknown>> = [];
    const run = createWorkerCycle({
      state,
      rpc: {async confirmTransaction(hash) {
        return {txHash: hash, ledger: 901};
      }},
      config: {intervalMs: 1000},
      source: {async getSettlementEvents() {
        throw new Error('events must not be scanned without a start ledger');
      }},
      cursorStore: {async load() {
        return null;
      }, async save() {}},
      log: entry => logs.push(entry),
    });

    await run();
    expect(state.confirmed).toEqual([{intentId: 'intent-1', ledger: 901}]);
    expect(logs).toEqual([{event: 'worker_receipt_cycle', scanned: 1, confirmed: 1, failed: 0, pending: 0}]);
  });

  it('reconciles one event page and advances the cursor when scanning is configured', async () => {
    const state = fakeState([{intentId: 'intent-1', transactionHash: txHash}]);
    const saved: Array<{cursor: string; startLedger: number}> = [];
    const logs: Array<Record<string, unknown>> = [];
    const page: SettlementEventPage = {
      events: [{
        eventId: 'event-1',
        transactionHash: txHash,
        ledger: 901,
        intentId: 'intent-1',
        merchantId: 'merchant-1',
        customer: 'customer',
        recipient: 'recipient',
        token: 'token',
        amount: '10',
      }],
      cursor: 'cursor-2',
      latestLedger: 902,
      oldestLedger: 800,
    };
    const requests: Array<Record<string, unknown>> = [];
    const run = createWorkerCycle({
      state,
      rpc: {async confirmTransaction(hash) {
        return {txHash: hash, ledger: 901};
      }},
      config: {intervalMs: 1000, eventStartLedger: 900, eventLimit: 25},
      source: {async getSettlementEvents(input) {
        requests.push(input);
        return page;
      }},
      cursorStore: {async load() {
        return null;
      }, async save(cursor) {
        saved.push(cursor);
      }},
      log: entry => logs.push(entry),
    });

    await run();
    expect(requests).toEqual([{startLedger: 900, limit: 25}]);
    expect(saved).toEqual([{cursor: 'cursor-2', startLedger: 902}]);
    expect(logs.map(entry => entry.event)).toEqual(['worker_receipt_cycle', 'worker_event_cycle']);
  });
});
