import type {AssetRate, RateProvider} from '../application/PriceService';
import {decimalsFor} from '../application/PriceService';

/**
 * Reads rates from CoinGecko's public simple-price endpoint.
 *
 * It is a market feed, not an anchor: it says what a lumen trades at, and
 * promises nothing about what anyone will actually pay. That is the right
 * strength for pricing a menu — the merchant sets a lira price and the customer
 * sends the asset — and the wrong strength for settling a foreign exchange,
 * which this deployment does not do.
 *
 * Chosen because it prices Turkish lira without an API key, which the on-ramp
 * feeds do not: MoonPay's price endpoint answers 401 without one, and it is a
 * card ramp rather than a rate service in any case.
 */
const DEFAULT_ENDPOINT = 'https://api.coingecko.com/api/v3/simple/price';

/** SEP-38 sell asset to the id CoinGecko knows it by. */
const DEFAULT_COIN_IDS: Record<string, string> = {
  'stellar:native': 'stellar',
  'stellar:USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5': 'usd-coin',
};

/** SEP-38 buy asset to the `vs_currency` that prices it. */
const DEFAULT_CURRENCIES: Record<string, string> = {
  'iso4217:TRY': 'try',
  'iso4217:USD': 'usd',
};

export type CoinGeckoRateProviderOptions = {
  fetcher?: typeof fetch;
  endpoint?: string;
  coinIds?: Record<string, string>;
  currencies?: Record<string, string>;
  apiKey?: string;
  timeoutMs?: number;
};

export class CoinGeckoRateProvider implements RateProvider {
  private readonly fetcher: typeof fetch;
  private readonly endpoint: string;
  private readonly coinIds: Record<string, string>;
  private readonly currencies: Record<string, string>;

  constructor(private readonly options: CoinGeckoRateProviderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.coinIds = options.coinIds ?? DEFAULT_COIN_IDS;
    this.currencies = options.currencies ?? DEFAULT_CURRENCIES;
  }

  async ratesFor(sellAsset: string): Promise<AssetRate[]> {
    const coinId = this.coinIds[sellAsset];
    if (!coinId) return [];

    const url = new URL(this.endpoint);
    url.searchParams.set('ids', coinId);
    url.searchParams.set('vs_currencies', Object.values(this.currencies).join(','));

    const signal = AbortSignal.timeout(this.options.timeoutMs ?? 8_000);
    const response = await this.fetcher(url.toString(), {
      signal,
      headers: this.options.apiKey ? {'x-cg-demo-api-key': this.options.apiKey} : {},
    });
    if (!response.ok) {
      throw new Error(`The rate feed answered ${response.status}`);
    }

    const body = (await response.json()) as Record<string, Record<string, unknown>>;
    const quoted = body[coinId];
    if (!quoted) throw new Error(`The rate feed does not price ${sellAsset}`);

    const rates: AssetRate[] = [];
    for (const [asset, vsCurrency] of Object.entries(this.currencies)) {
      const value = quoted[vsCurrency];
      // A rate of zero or a missing one is left out rather than published as a
      // number: a price of nothing would make a paid coffee look free.
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue;
      /*
       * The feed says how much fiat one lumen is worth; SEP-38 asks the
       * opposite — units of the sold asset for one unit of the bought one. So
       * this is inverted before it is published.
       *
       * It used not to be, and nothing caught it, because the only reader was
       * this project's own app inverting it back. The first real anchor we
       * pointed at quoted the other way and a 500 lira coffee became 24,095
       * USDC. Serving the standard's direction is what makes the two
       * interchangeable, which is the entire point of speaking SEP-38.
       */
      rates.push({asset, price: (1 / value).toFixed(10), decimals: decimalsFor(asset)});
    }
    return rates;
  }
}
