import {createStellarConfig, quoteSwapFunding} from '@rosapay/stellar';
import {readIndicativePrices} from '@rosapay/anchor';
import type {AssetRate, RateProvider} from '../application/PriceService';
import {decimalsFor} from '../application/PriceService';

/**
 * Prices an asset through the money this deployment actually moves.
 *
 * The lira rate has an anchor behind it — a SEP-6 TRY/USDC ramp that publishes
 * an `ANCHOR_QUOTE_SERVER` — but it quotes one asset, USDC, because that is the
 * only thing it ramps. Ask it about lumens and it answers HTTP 400, so lumens
 * used to fall through to a market feed, which is a different kind of number:
 * what a lumen trades at somewhere, rather than what this deployment would give
 * you for one.
 *
 * So lumens are priced the way they are actually spent. The settlement contract
 * funds a USDC payment from an XLM balance by swapping through Soroswap, and
 * this asks that same router what the swap would cost, then asks the anchor what
 * the USDC is worth in lira. Two legs, both of them things that would really
 * happen:
 *
 *   XLM per TRY  =  XLM per USDC (Soroswap)  ×  USDC per TRY (anchor)
 *
 * The figure that comes out is lower than a market feed's on Testnet, and that
 * is the point rather than a defect: the pool is what a customer would really
 * swap against, so it is the truth about this deployment. On a network whose
 * pool tracks the market the two converge.
 *
 * Only what the anchor will quote comes back from here. Dollars, euro and naira
 * have no anchor leg, so they are left to whatever provider runs behind this
 * one, and a deployment with no fallback simply does not offer them.
 */

/** SEP-38 price semantics: units of the sold asset for one unit of the bought one. */
const PRICE_DECIMALS = 10;

export type AnchorBridgedRateProviderOptions = {
  /** The anchor's SEP-38 server, from its stellar.toml. */
  quoteServer: string;
  /** SEP-38 identifier of the asset the anchor prices, e.g. `stellar:USDC:G…`. */
  bridgeAsset: string;
  /** The bridge asset's SAC address, which is what Soroswap swaps. */
  bridgeContractId: string;
  /** The SAC of the asset being priced through the bridge, e.g. native. */
  sellContractId: string;
  /** SEP-38 identifier of that asset, e.g. `stellar:native`. */
  sellAsset: string;
  /** Soroswap's router, the same one the settlement contract holds. */
  routerContractId: string;
  network?: 'testnet' | 'pubnet';
  fetcher?: typeof fetch;
  /** Injectable so tests need neither a pool nor a network. */
  quoteBridgeUnits?(): Promise<bigint>;
};

export class AnchorBridgedRateProvider implements RateProvider {
  constructor(private readonly options: AnchorBridgedRateProviderOptions) {}

  async ratesFor(sellAsset: string): Promise<AssetRate[]> {
    const anchorRates = await this.anchorRates();
    // The anchor asset needs no bridge: it is what the anchor quotes.
    if (sellAsset === this.options.bridgeAsset) return anchorRates;
    if (sellAsset !== this.options.sellAsset) return [];
    if (anchorRates.length === 0) return [];

    const bridgeUnits = await this.bridgeUnitsPerSold();
    // A pool that cannot price one unit prices nothing, and saying so is what
    // keeps the fallback provider from being skipped.
    if (bridgeUnits <= 0) return [];

    return anchorRates.map(rate => ({
      asset: rate.asset,
      // rate.price is bridge-asset units per one unit of `rate.asset`, and
      // bridgeUnits is sold-asset units per one bridge-asset unit, so the
      // product is sold-asset units per one unit of `rate.asset` — which is
      // what SEP-38 asks for.
      price: (Number(rate.price) * bridgeUnits).toFixed(PRICE_DECIMALS),
      decimals: decimalsFor(rate.asset),
    }));
  }

  /** What the anchor says one unit of its own asset is worth, per currency. */
  private async anchorRates(): Promise<AssetRate[]> {
    const prices = await readIndicativePrices({
      source: {quoteServer: this.options.quoteServer},
      sellAsset: this.options.bridgeAsset,
      sellAmount: '1',
      ...(this.options.fetcher ? {fetcher: this.options.fetcher} : {}),
    });
    return prices
      .filter(price => Number(price.price) > 0)
      .map(price => ({
        asset: price.asset,
        price: price.price,
        decimals: decimalsFor(price.asset),
      }));
  }

  /**
   * How many units of the sold asset buy one unit of the bridge asset.
   *
   * Asked as `router_get_amounts_in` for exactly one bridge unit, which is the
   * same call the settlement path makes — so the number quoted here is the
   * number a payment would really be funded at, not a mid-price derived from
   * reserves.
   */
  private async bridgeUnitsPerSold(): Promise<number> {
    if (this.options.quoteBridgeUnits) {
      return Number(await this.options.quoteBridgeUnits()) / 1e7;
    }
    const oneBridgeUnit = 10_000_000n;
    const quote = await quoteSwapFunding({
      config: createStellarConfig(this.options.network ?? 'testnet'),
      routerContractId: this.options.routerContractId,
      path: [this.options.sellContractId, this.options.bridgeContractId],
      settlementToken: this.options.bridgeContractId,
      amountOut: oneBridgeUnit,
    });
    return Number(quote.amountIn) / 1e7;
  }
}

/**
 * Tries each provider in turn and keeps the first rate offered per currency.
 *
 * Order is precedence: an anchor-backed rate for lira should win over a market
 * feed's, while the currencies the anchor knows nothing about still come back
 * from whatever is behind it. A provider that throws is treated as one that had
 * nothing to say — the next one is asked — and only an empty result from all of
 * them is a failure worth reporting upward.
 */
export class CompositeRateProvider implements RateProvider {
  constructor(private readonly providers: readonly RateProvider[]) {}

  async ratesFor(sellAsset: string): Promise<AssetRate[]> {
    const byAsset = new Map<string, AssetRate>();
    const failures: string[] = [];

    for (const provider of this.providers) {
      let rates: AssetRate[];
      try {
        rates = await provider.ratesFor(sellAsset);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : 'a rate source failed');
        continue;
      }
      for (const rate of rates) {
        if (!byAsset.has(rate.asset)) byAsset.set(rate.asset, rate);
      }
    }

    // Every source failed rather than merely declining: the caller has to hear
    // why, or a throttled feed looks the same as an unpriceable asset.
    if (byAsset.size === 0 && failures.length > 0) {
      throw new Error(failures[0]);
    }
    return [...byAsset.values()];
  }
}
