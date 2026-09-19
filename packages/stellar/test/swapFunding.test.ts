import {describe, expect, it, vi} from 'vitest';
import {createStellarConfig} from '../src/config';
import {
  DEFAULT_SWAP_SLIPPAGE_BPS,
  SwapFundingError,
  assertFundingPath,
  quoteSwapFunding,
} from '../src/swapFunding';

const xlm = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const usdc = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const router = 'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';

const config = createStellarConfig('testnet');

function priced(amountIn: bigint) {
  return vi.fn(async () => [amountIn, 1_000_000n]);
}

describe('funding paths', () => {
  it('accepts a path that ends where the merchant asked', () => {
    expect(() => assertFundingPath([xlm, usdc], usdc)).not.toThrow();
  });

  it('refuses a path that would buy something else', () => {
    expect(() => assertFundingPath([usdc, xlm], usdc)).toThrow(SwapFundingError);
  });

  it('refuses a path that starts where it ends, which only costs a fee', () => {
    expect(() => assertFundingPath([usdc, usdc], usdc)).toThrow(SwapFundingError);
  });

  it('refuses a path with nowhere to go', () => {
    expect(() => assertFundingPath([usdc], usdc)).toThrow(SwapFundingError);
    expect(() => assertFundingPath([], usdc)).toThrow(SwapFundingError);
  });
});

describe('quoting a funded payment', () => {
  it('reports what the pool wants and the ceiling the contract may spend', async () => {
    const quote = await quoteSwapFunding({
      config,
      routerContractId: router,
      path: [xlm, usdc],
      settlementToken: usdc,
      amountOut: 1_000_000n,
      quoteAmountsIn: priced(9_465_832n),
    });

    expect(quote.amountIn).toBe(9_465_832n);
    expect(quote.amountOut).toBe(1_000_000n);
    expect(quote.slippageBps).toBe(DEFAULT_SWAP_SLIPPAGE_BPS);
    // 50 bps over the quote, computed in integers rather than through a float.
    expect(quote.amountInMax).toBe((9_465_832n * 10_050n) / 10_000n);
    expect(quote.amountInMax).toBeGreaterThan(quote.amountIn);
  });

  it('never rounds a ceiling through a float', async () => {
    const quote = await quoteSwapFunding({
      config,
      routerContractId: router,
      path: [xlm, usdc],
      settlementToken: usdc,
      amountOut: 1n,
      slippageBps: 1,
      quoteAmountsIn: priced(99_999_999_999_999_999n),
    });
    expect(quote.amountInMax).toBe((99_999_999_999_999_999n * 10_001n) / 10_000n);
  });

  it('honours a slippage the caller chose', async () => {
    const quote = await quoteSwapFunding({
      config,
      routerContractId: router,
      path: [xlm, usdc],
      settlementToken: usdc,
      amountOut: 1_000_000n,
      slippageBps: 0,
      quoteAmountsIn: priced(9_465_832n),
    });
    expect(quote.amountInMax).toBe(quote.amountIn);
  });

  it('refuses a slippage outside the representable range', async () => {
    await expect(
      quoteSwapFunding({
        config,
        routerContractId: router,
        path: [xlm, usdc],
        settlementToken: usdc,
        amountOut: 1_000_000n,
        slippageBps: 10_001,
        quoteAmountsIn: priced(1n),
      }),
    ).rejects.toThrow(SwapFundingError);
  });

  it('refuses to quote a non-positive payment', async () => {
    await expect(
      quoteSwapFunding({
        config,
        routerContractId: router,
        path: [xlm, usdc],
        settlementToken: usdc,
        amountOut: 0n,
        quoteAmountsIn: priced(1n),
      }),
    ).rejects.toThrow(SwapFundingError);
  });

  it('reads a router that cannot price the route as no route', async () => {
    const failing = vi.fn(async () => {
      throw new Error('no pool');
    });
    await expect(
      quoteSwapFunding({
        config,
        routerContractId: router,
        path: [xlm, usdc],
        settlementToken: usdc,
        amountOut: 1_000_000n,
        quoteAmountsIn: failing,
      }),
    ).rejects.toMatchObject({code: 'NO_ROUTE'});
  });

  it('reads an empty or zero quote as no route rather than a free payment', async () => {
    for (const amounts of [[], [0n, 1_000_000n]]) {
      await expect(
        quoteSwapFunding({
          config,
          routerContractId: router,
          path: [xlm, usdc],
          settlementToken: usdc,
          amountOut: 1_000_000n,
          quoteAmountsIn: async () => amounts as bigint[],
        }),
      ).rejects.toMatchObject({code: 'NO_ROUTE'});
    }
  });

  it('checks the path before it asks a router anything', async () => {
    const quoter = vi.fn(async () => [1n]);
    await expect(
      quoteSwapFunding({
        config,
        routerContractId: router,
        path: [usdc, xlm],
        settlementToken: usdc,
        amountOut: 1_000_000n,
        quoteAmountsIn: quoter,
      }),
    ).rejects.toThrow(SwapFundingError);
    expect(quoter).not.toHaveBeenCalled();
  });
});
