import {describe, expect, it} from 'vitest';
import {
  AnchorBridgedRateProvider,
  CompositeRateProvider,
} from '../src/infrastructure/AnchorBridgedRateProvider';
import type {AssetRate, RateProvider} from '../src/application/PriceService';

const usdc = 'stellar:USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const usdcContract = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const xlmContract = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

/** The anchor's real answer: USDC per one lira, and nothing else quoted. */
function anchorServing(prices: {asset: string; price: string}[] = [{asset: 'iso4217:TRY', price: '0.0206739715'}]) {
  return async () =>
    new Response(JSON.stringify({buy_assets: prices.map(p => ({...p, decimals: 2}))}), {
      status: 200,
      headers: {'content-type': 'application/json'},
    });
}

function bridged(overrides: Partial<Parameters<typeof makeOptions>[0]> = {}) {
  return new AnchorBridgedRateProvider(makeOptions(overrides));
}

function makeOptions(overrides: {
  fetcher?: typeof fetch;
  quoteBridgeUnits?: () => Promise<bigint>;
} = {}) {
  return {
    quoteServer: 'https://anchor.example/sep38',
    bridgeAsset: usdc,
    bridgeContractId: usdcContract,
    sellAsset: 'stellar:native',
    sellContractId: xlmContract,
    routerContractId: 'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD',
    fetcher: overrides.fetcher ?? (anchorServing() as unknown as typeof fetch),
    // 9.5343945 XLM buys one USDC, which is what the Testnet pool quoted.
    quoteBridgeUnits: overrides.quoteBridgeUnits ?? (async () => 95_343_945n),
  };
}

describe('pricing lumens through the asset the anchor ramps', () => {
  it('multiplies the swap leg by the anchor leg, in SEP-38 direction', async () => {
    const rates = await bridged().ratesFor('stellar:native');

    // 0.0206739715 USDC per lira × 9.5343945 XLM per USDC = 0.1971138 XLM per lira.
    expect(rates).toHaveLength(1);
    expect(rates[0]!.asset).toBe('iso4217:TRY');
    expect(Number(rates[0]!.price)).toBeCloseTo(0.1971138, 6);
    // Fiat carries two places; the price itself keeps ten.
    expect(rates[0]!.decimals).toBe(2);
  });

  it('reads back as a plausible balance, which is the check that catches an inversion', async () => {
    const [rate] = await bridged().ratesFor('stellar:native');

    // The app divides: fiat = amount / price. Getting the direction wrong here
    // once turned a 500 lira coffee into 24,095 USDC, so the arithmetic that
    // screens actually perform is what this asserts.
    const lira = 10_000 / Number(rate!.price);
    expect(lira).toBeGreaterThan(40_000);
    expect(lira).toBeLessThan(60_000);
  });

  it('passes the anchor asset straight through, unbridged', async () => {
    const rates = await bridged().ratesFor(usdc);

    // USDC needs no swap leg: it is what the anchor quotes.
    expect(rates).toHaveLength(1);
    expect(Number(rates[0]!.price)).toBeCloseTo(0.0206739715, 9);
  });

  it('offers nothing for an asset it has no bridge for', async () => {
    await expect(bridged().ratesFor('stellar:EURC:GABC')).resolves.toEqual([]);
  });

  it('declines rather than guessing when the pool cannot price a unit', async () => {
    const provider = bridged({quoteBridgeUnits: async () => 0n});
    // An empty result is what lets the fallback provider be reached. Returning
    // a zero price would put "worth nothing" on a wallet that holds lumens.
    await expect(provider.ratesFor('stellar:native')).resolves.toEqual([]);
  });

  it('prices the dollar from the swap leg alone, because USDC is pegged to it', async () => {
    const provider = new AnchorBridgedRateProvider({
      ...makeOptions(),
      peggedCurrencies: ['iso4217:USD'],
    });

    const rates = await provider.ratesFor('stellar:native');
    const usd = rates.find(rate => rate.asset === 'iso4217:USD');

    // One USDC is one dollar, so a lumen's dollar price is just what the pool
    // charges for a USDC: 9.5343945 XLM. No feed is involved, which is why the
    // dollar cannot go missing from the picker when CoinGecko is throttled.
    expect(Number(usd!.price)).toBeCloseTo(9.5343945, 6);
    expect(10_000 / Number(usd!.price)).toBeCloseTo(1048.79, 1);
  });

  it('lets a real quote beat the peg where the anchor has one', async () => {
    const provider = new AnchorBridgedRateProvider({
      ...makeOptions({
        fetcher: anchorServing([{asset: 'iso4217:USD', price: '0.9980000000'}]) as unknown as typeof fetch,
      }),
      peggedCurrencies: ['iso4217:USD'],
    });

    const [rate] = await provider.ratesFor(usdc);

    // A peg is a claim about the asset; a quote is what somebody would trade
    // at. Where both exist the quote is the better number.
    expect(Number(rate!.price)).toBeCloseTo(0.998, 6);
  });

  it('keeps the pegged currency when the anchor is unreachable', async () => {
    const provider = new AnchorBridgedRateProvider({
      ...makeOptions({
        fetcher: (async () => {
          throw new Error('anchor unreachable');
        }) as unknown as typeof fetch,
      }),
      peggedCurrencies: ['iso4217:USD'],
    });

    // The dollar price of a USDC balance needs no anchor at all, so losing the
    // anchor must not take it down too.
    const rates = await provider.ratesFor('stellar:native');
    expect(rates.map(rate => rate.asset)).toEqual(['iso4217:USD']);
  });

  it('still fails when the anchor is unreachable and nothing is pegged', async () => {
    const provider = bridged({
      fetcher: (async () => {
        throw new Error('anchor unreachable');
      }) as unknown as typeof fetch,
    });

    await expect(provider.ratesFor('stellar:native')).rejects.toThrow('anchor unreachable');
  });

  it('carries every currency the anchor quotes, not just lira', async () => {
    const provider = bridged({
      fetcher: anchorServing([
        {asset: 'iso4217:TRY', price: '0.0206739715'},
        {asset: 'iso4217:USD', price: '1.0000000000'},
      ]) as unknown as typeof fetch,
    });

    const rates = await provider.ratesFor('stellar:native');
    expect(rates.map(rate => rate.asset)).toEqual(['iso4217:TRY', 'iso4217:USD']);
  });
});

function stub(rates: AssetRate[]): RateProvider {
  return {ratesFor: async () => rates};
}

function failing(message: string): RateProvider {
  return {
    ratesFor: async () => {
      throw new Error(message);
    },
  };
}

describe('composing an anchor rate with a market feed behind it', () => {
  const anchorTry: AssetRate = {asset: 'iso4217:TRY', price: '0.1971138', decimals: 2};
  const feedTry: AssetRate = {asset: 'iso4217:TRY', price: '0.1071812', decimals: 2};
  const feedUsd: AssetRate = {asset: 'iso4217:USD', price: '3.5000000', decimals: 2};

  it('prefers the anchor for lira and takes the rest from the feed', async () => {
    const composite = new CompositeRateProvider([stub([anchorTry]), stub([feedTry, feedUsd])]);

    const rates = await composite.ratesFor('stellar:native');

    // The anchor is the source that would actually exchange at its number.
    expect(rates.find(rate => rate.asset === 'iso4217:TRY')).toEqual(anchorTry);
    expect(rates.find(rate => rate.asset === 'iso4217:USD')).toEqual(feedUsd);
  });

  it('keeps lira working when the market feed is throttled', async () => {
    const composite = new CompositeRateProvider([
      stub([anchorTry]),
      failing('The rate feed answered 429'),
    ]);

    // This is the whole point of the ordering: a 429 used to remove every
    // conversion, lira included, because the feed was the only source.
    await expect(composite.ratesFor('stellar:native')).resolves.toEqual([anchorTry]);
  });

  it('falls back whole when the anchor is unreachable', async () => {
    const composite = new CompositeRateProvider([
      failing('anchor unreachable'),
      stub([feedTry, feedUsd]),
    ]);

    await expect(composite.ratesFor('stellar:native')).resolves.toEqual([feedTry, feedUsd]);
  });

  it('reports why when every source failed, rather than looking unpriceable', async () => {
    const composite = new CompositeRateProvider([
      failing('anchor unreachable'),
      failing('The rate feed answered 429'),
    ]);

    // An asset nobody prices and an asset nothing could be asked about are
    // different problems, and the operator needs to be able to tell them apart.
    await expect(composite.ratesFor('stellar:native')).rejects.toThrow('anchor unreachable');
  });

  it('stays quiet for an asset every source simply declines', async () => {
    const composite = new CompositeRateProvider([stub([]), stub([])]);
    await expect(composite.ratesFor('stellar:EURC:GABC')).resolves.toEqual([]);
  });
});
