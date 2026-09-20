import {applyUnreconciledSpend, knownHolding, unreconciledSpend} from '../src/shared/unreconciledSpend';
import type {LocalReceipt} from '../src/state/appStore';

const READ_AT = Date.parse('2026-09-20T10:00:00.000Z');

function receipt(overrides: Partial<LocalReceipt> = {}): LocalReceipt {
  return {
    intentId: 'intent-1',
    merchantName: 'Rose Coffee',
    recipient: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    amount: '40',
    assetCode: 'XLM',
    network: 'testnet',
    payloadHash: 'hash',
    status: 'confirmed',
    transactionHash: 'a'.repeat(64),
    createdAt: '2026-09-20T10:05:00.000Z',
    confirmedAt: '2026-09-20T10:05:00.000Z',
    transport: 'ble',
    ...overrides,
  };
}

describe('what a phone knows it has spent since it last saw the chain', () => {
  it('takes an offline payment off the balance the card is still showing', () => {
    // The case this exists for: fifty lumens read while online, forty paid at a
    // counter with no connection, and no way to re-read the chain afterwards.
    const spent = unreconciledSpend([receipt()], READ_AT);
    expect(applyUnreconciledSpend([{code: 'XLM', amount: '50'}], spent)).toEqual([
      {code: 'XLM', amount: '10'},
    ]);
  });

  it('counts every payment made since that reading, not just the last', () => {
    const spent = unreconciledSpend(
      [receipt({intentId: 'a', amount: '40'}), receipt({intentId: 'b', amount: '5.5'})],
      READ_AT,
    );
    expect(spent.get('XLM')).toBe(45.5);
  });

  it('leaves alone anything the chain reading already includes', () => {
    // A payment made before the balance was read is already in that number, and
    // subtracting it again would understate what is left.
    const spent = unreconciledSpend([receipt({confirmedAt: '2026-09-20T09:00:00.000Z'})], READ_AT);
    expect(spent.size).toBe(0);
  });

  it('only counts payments that actually settled', () => {
    const spent = unreconciledSpend(
      [
        receipt({status: 'failed'}),
        receipt({status: 'confirmed', transactionHash: ''}),
        receipt({amount: 'not a number'}),
      ],
      READ_AT,
    );
    expect(spent.size).toBe(0);
  });

  it('keeps each asset to itself', () => {
    const spent = unreconciledSpend(
      [receipt({amount: '40'}), receipt({assetCode: 'USDC', amount: '3'})],
      READ_AT,
    );
    expect(applyUnreconciledSpend(
      [{code: 'XLM', amount: '50'}, {code: 'USDC', amount: '10'}],
      spent,
    )).toEqual([{code: 'XLM', amount: '10'}, {code: 'USDC', amount: '7'}]);
  });

  it('never shows a negative balance, however old the reading is', () => {
    const spent = unreconciledSpend([receipt({amount: '400'})], READ_AT);
    expect(applyUnreconciledSpend([{code: 'XLM', amount: '50'}], spent)).toEqual([
      {code: 'XLM', amount: '0'},
    ]);
  });

  it('subtracts nothing when this phone has never read the chain', () => {
    expect(unreconciledSpend([receipt()], undefined).size).toBe(0);
  });

  it('says nothing about an asset it has never seen a balance for', () => {
    // Which is the difference between "you have none" and "I do not know", and
    // only the second one is true offline.
    expect(knownHolding(undefined, 'XLM')).toBeUndefined();
    expect(knownHolding([{code: 'USDC', amount: '5'}], 'XLM')).toBeUndefined();
    expect(knownHolding([{code: 'XLM', amount: '12.5'}], 'XLM')).toBe(12.5);
  });
});
