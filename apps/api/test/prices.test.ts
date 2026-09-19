import {afterEach, describe, expect, it, vi} from 'vitest';
import {buildApp} from '../src/app';
import {PriceService, PriceUnavailableError, type AssetRate, type RateProvider} from '../src/application/PriceService';
import {CoinGeckoRateProvider} from '../src/infrastructure/CoinGeckoRateProvider';

const xlm = 'stellar:native';
const usdc = 'stellar:USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(app => app.close())));

function provider(rates: AssetRate[] | (() => Promise<AssetRate[]>)): RateProvider & {calls: number} {
  const state = {calls: 0};
  return {
    get calls() {
      return state.calls;
    },
    ratesFor: async () => {
      state.calls += 1;
      return typeof rates === 'function' ? rates() : rates;
    },
  };
}

function service(overrides: Partial<ConstructorParameters<typeof PriceService>[0]> = {}) {
  return new PriceService({
    provider: provider([{asset: 'iso4217:TRY', price: '0.1115', decimals: 2}]),
    sellAssets: [xlm, usdc],
    buyAssets: ['iso4217:TRY', 'iso4217:USD'],
    ...overrides,
  });
}

describe('the deployment’s own SEP-38 prices', () => {
  it('publishes what it will price, both sides', () => {
    expect(service().info()).toEqual({
      assets: [{asset: xlm}, {asset: usdc}, {asset: 'iso4217:TRY'}, {asset: 'iso4217:USD'}],
    });
  });

  it('prices a lumen in lira, which is the whole reason this exists', async () => {
    const prices = await service().prices({sellAsset: xlm, sellAmount: '1'});
    expect(prices).toEqual({buy_assets: [{asset: 'iso4217:TRY', price: '0.1115', decimals: 2}]});
  });

  /**
   * SEP-38 prices per unit, not per the amount asked about. Multiplying here
   * as well would square the rate, and a 100 XLM balance would read as 89,700
   * lira instead of 897.
   */
  it('quotes per unit however much is being sold', async () => {
    const priced = service();
    const one = await priced.prices({sellAsset: xlm, sellAmount: '1'});
    const many = await priced.prices({sellAsset: xlm, sellAmount: '100'});
    expect(many.buy_assets[0]!.price).toBe(one.buy_assets[0]!.price);
  });

  it('refuses an asset it was not configured to price', async () => {
    await expect(
      service().prices({sellAsset: 'stellar:DOGET:GABC', sellAmount: '1'}),
    ).rejects.toBeInstanceOf(PriceUnavailableError);
  });

  it('refuses a sell amount that is not a positive number', async () => {
    for (const sellAmount of ['0', '-5', 'abc', '']) {
      await expect(service().prices({sellAsset: xlm, sellAmount})).rejects.toBeInstanceOf(
        PriceUnavailableError,
      );
    }
  });

  it('drops a currency the feed does not price rather than publishing it', async () => {
    const priced = service({
      provider: provider([
        {asset: 'iso4217:TRY', price: '8.97', decimals: 2},
        {asset: 'iso4217:BRL', price: '1.05', decimals: 2},
      ]),
    });
    const prices = await priced.prices({sellAsset: xlm, sellAmount: '1'});
    expect(prices.buy_assets.map(rate => rate.asset)).toEqual(['iso4217:TRY']);
  });

  it('fails rather than serving a rate of zero', async () => {
    const priced = service({provider: provider([{asset: 'iso4217:TRY', price: '0', decimals: 2}])});
    await expect(priced.prices({sellAsset: xlm, sellAmount: '1'})).rejects.toBeInstanceOf(
      PriceUnavailableError,
    );
  });

  it('reads the feed once per window however many callers ask', async () => {
    const feed = provider([{asset: 'iso4217:TRY', price: '8.97', decimals: 2}]);
    let now = 1_000;
    const priced = service({provider: feed, cacheMs: 60_000, now: () => now});

    await Promise.all([
      priced.prices({sellAsset: xlm, sellAmount: '1'}),
      priced.prices({sellAsset: xlm, sellAmount: '2'}),
    ]);
    await priced.prices({sellAsset: xlm, sellAmount: '3'});
    expect(feed.calls).toBe(1);

    now += 60_001;
    await priced.prices({sellAsset: xlm, sellAmount: '4'});
    expect(feed.calls).toBe(2);
  });

  /**
   * A stale rate on a payment screen prices a sale at a number the market has
   * already left, so a failed read has to clear what it was covering for.
   */
  it('stops answering when the feed goes down rather than serving a stale rate', async () => {
    let healthy = true;
    let now = 1_000;
    const priced = service({
      provider: provider(async () => {
        if (!healthy) throw new Error('feed is down');
        return [{asset: 'iso4217:TRY', price: '8.97', decimals: 2}];
      }),
      cacheMs: 60_000,
      now: () => now,
    });

    await expect(priced.prices({sellAsset: xlm, sellAmount: '1'})).resolves.toBeTruthy();
    healthy = false;
    now += 60_001;
    await expect(priced.prices({sellAsset: xlm, sellAmount: '1'})).rejects.toBeInstanceOf(
      PriceUnavailableError,
    );
  });
});

describe('the rate feed adapter', () => {
  const body = {stellar: {try: 8.97, usd: 0.1851}};

  /**
   * Published in SEP-38's direction — units of the sold asset for one unit of
   * the bought one — not the feed's. A lumen worth 8.97 lira means one lira
   * costs 0.1115 lumens, and that second number is what the standard asks for.
   * Serving the first is what made a real anchor and this server disagree by a
   * factor of eighty.
   */
  it('publishes rates in the direction SEP-38 asks for, not the feed’s', async () => {
    const fetcher = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify(body), {status: 200})),
    );
    const rates = await new CoinGeckoRateProvider({fetcher: fetcher as unknown as typeof fetch}).ratesFor(xlm);

    expect(rates.map(rate => rate.asset)).toEqual(['iso4217:TRY', 'iso4217:USD']);
    expect(Number(rates[0]!.price)).toBeCloseTo(1 / 8.97, 6);
    expect(Number(rates[1]!.price)).toBeCloseTo(1 / 0.1851, 4);
    const url = fetcher.mock.calls[0]![0];
    expect(url).toContain('ids=stellar');
    expect(url).toContain('vs_currencies=try%2Cusd');
  });

  it('says nothing about an asset it does not know', async () => {
    const fetcher = vi.fn(async () => new Response('{}', {status: 200}));
    await expect(
      new CoinGeckoRateProvider({fetcher: fetcher as unknown as typeof fetch}).ratesFor('stellar:NOPE:GABC'),
    ).resolves.toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('throws when the feed refuses, instead of reporting no rates', async () => {
    // An empty list means "this currency is not priced"; a 429 means "ask
    // again". Collapsing them would make a rate limit look like a missing
    // currency and quietly remove lira from the merchant's screen.
    const fetcher = vi.fn(async () => new Response('rate limited', {status: 429}));
    await expect(
      new CoinGeckoRateProvider({fetcher: fetcher as unknown as typeof fetch}).ratesFor(xlm),
    ).rejects.toThrow(/429/);
  });

  it('leaves out a currency the feed returned as zero or missing', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({stellar: {try: 0, usd: 0.1851}}), {status: 200}),
    );
    const rates = await new CoinGeckoRateProvider({fetcher: fetcher as unknown as typeof fetch}).ratesFor(xlm);
    expect(rates.map(rate => rate.asset)).toEqual(['iso4217:USD']);
  });
});

describe('the SEP-38 routes', () => {
  function app(prices?: PriceService) {
    const built = buildApp(prices ? {prices} : {});
    apps.push(built);
    return built;
  }

  it('serves info and prices unauthenticated, as SEP-38 specifies', async () => {
    const built = app(service());

    const info = await built.inject({method: 'GET', url: '/sep38/info'});
    expect(info.statusCode).toBe(200);
    expect(info.json().assets).toContainEqual({asset: 'iso4217:TRY'});

    const prices = await built.inject({
      method: 'GET',
      url: `/sep38/prices?sell_asset=${encodeURIComponent(xlm)}&sell_amount=1`,
    });
    expect(prices.statusCode).toBe(200);
    expect(prices.json().buy_assets).toEqual([{asset: 'iso4217:TRY', price: '0.1115', decimals: 2}]);
  });

  it('defaults to one unit, because that is what a rate is', async () => {
    const response = await app(service()).inject({
      method: 'GET',
      url: `/sep38/prices?sell_asset=${encodeURIComponent(xlm)}`,
    });
    expect(response.statusCode).toBe(200);
  });

  it('answers 503 when no rate is available, not 400', async () => {
    const priced = service({provider: provider(async () => Promise.reject(new Error('feed is down')))});
    const response = await app(priced).inject({
      method: 'GET',
      url: `/sep38/prices?sell_asset=${encodeURIComponent(xlm)}&sell_amount=1`,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('PRICE_UNAVAILABLE');
  });

  it('says so plainly when the deployment serves no rates at all', async () => {
    const response = await app().inject({method: 'GET', url: '/sep38/info'});
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('PRICING_DISABLED');
  });

  it('rejects a request with no sell asset', async () => {
    const response = await app(service()).inject({method: 'GET', url: '/sep38/prices'});
    expect(response.statusCode).toBe(400);
  });
});
