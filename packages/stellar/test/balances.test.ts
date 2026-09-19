import {describe, expect, it, vi} from 'vitest';
import {Networks, nativeToScVal, rpc} from '@stellar/stellar-sdk';
import {createStellarConfig} from '../src/config';
import {BalanceQueryError, formatStroops, parseStroops, readNativeBalance} from '../src/balances';

const holder = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';

function simulator(retval: unknown, ok = true) {
  return {
    simulateTransaction: vi.fn(async () => (ok
      ? {result: {retval}, transactionData: {}, minResourceFee: '1', latestLedger: 1, events: [], _parsed: true}
      : {error: 'boom', latestLedger: 1, events: [], id: '1', _parsed: true})),
  } as unknown as rpc.Server;
}

describe('native balances', () => {
  it('reads a balance the asset contract reports in stroops', async () => {
    const balance = await readNativeBalance(
      createStellarConfig('testnet'),
      holder,
      simulator(nativeToScVal(250_000_000n, {type: 'i128'})),
    );
    expect(balance).toBe('25');
  });

  it('keeps the full precision a payment can use', () => {
    expect(formatStroops(1_234_567n)).toBe('0.1234567');
    expect(formatStroops(10_000_000n)).toBe('1');
    expect(formatStroops(0n)).toBe('0');
    expect(formatStroops(-5_000_000n)).toBe('-0.5');
  });

  it('parses exact decimal amounts without floating-point rounding', () => {
    expect(parseStroops('25')).toBe(250_000_000n);
    expect(parseStroops('0.0000001')).toBe(1n);
    expect(parseStroops('9007199254740993.1234567')).toBe(90_071_992_547_409_931_234_567n);
    expect(() => parseStroops('1.00000001')).toThrow('at most 7 fractional digits');
    expect(() => parseStroops('-1')).toThrow('non-negative decimal');
  });

  it('fails loudly instead of reporting a zero balance', async () => {
    await expect(
      readNativeBalance(createStellarConfig('testnet'), holder, simulator(null, false)),
    ).rejects.toBeInstanceOf(BalanceQueryError);
  });

  it('targets the network the config names', async () => {
    const server = simulator(nativeToScVal(0n, {type: 'i128'}));
    await readNativeBalance({...createStellarConfig('testnet'), networkPassphrase: Networks.TESTNET}, holder, server);
    expect((server.simulateTransaction as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });
});
