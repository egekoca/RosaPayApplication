/**
 * A SEP-38 quote server for currencies no anchor will price.
 *
 * The app has always asked an anchor what a lumen is worth, which is the right
 * shape: the merchant prices a coffee in the money on their menu and the
 * contract moves an asset, and something has to hold the rate between them.
 * The trouble is that nothing on Stellar will quote Turkish lira. Surveying
 * every domain in the Stellar Anchor Directory turned up two that publish an
 * `ANCHOR_QUOTE_SERVER` at all, both the same operator, and the only fiat
 * either of them prices is the Brazilian real.
 *
 * So this deployment serves the rate itself, in exactly the SEP-38 shape the
 * mobile app already reads. Nothing on the phone learns a new protocol, and the
 * day a real lira anchor exists the app is pointed at its quote server and this
 * is deleted. What it costs is honesty about provenance: these are our rates,
 * from a public market feed, and the screens say so.
 *
 * Indicative only. SEP-38 `/prices` commits the server to nothing, and this
 * intentionally implements no `/quote` — a firm rate is a promise to honour it,
 * and this deployment settles on chain rather than exchanging anything.
 */

/** What one unit of a sold asset is worth, in some currency. */
export type AssetRate = {
  /** SEP-38 identifier of what is being bought, e.g. `iso4217:TRY`. */
  asset: string;
  /** How many units of `asset` one unit of the sold asset is worth. */
  price: string;
  decimals: number;
};

export interface RateProvider {
  /** Rates for one sold asset, or an empty list when the feed will not say. */
  ratesFor(sellAsset: string): Promise<AssetRate[]>;
}

export class PriceUnavailableError extends Error {
  readonly code = 'PRICE_UNAVAILABLE';
}

/** Fiat carries two decimal places; Stellar assets carry seven. */
const FIAT_DECIMALS = 2;
const STELLAR_DECIMALS = 7;

export function decimalsFor(asset: string): number {
  return asset.startsWith('iso4217:') ? FIAT_DECIMALS : STELLAR_DECIMALS;
}

export type PriceServiceOptions = {
  provider: RateProvider;
  /** Sold assets this deployment will price, as SEP-38 identifiers. */
  sellAssets: readonly string[];
  /** Bought assets it will price them in. */
  buyAssets: readonly string[];
  cacheMs?: number;
  now?: () => number;
};

type CacheEntry = {rates: AssetRate[]; readAt: number};

export class PriceService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<AssetRate[]>>();

  constructor(private readonly options: PriceServiceOptions) {}

  /** The SEP-38 `/info` document: what this server is willing to price. */
  info(): {assets: {asset: string}[]} {
    const assets = [...this.options.sellAssets, ...this.options.buyAssets];
    return {assets: [...new Set(assets)].map(asset => ({asset}))};
  }

  supportsSellAsset(asset: string): boolean {
    return this.options.sellAssets.includes(asset);
  }

  /**
   * The SEP-38 `/prices` document.
   *
   * `price` is per unit of the sold asset, not for the amount asked about,
   * which is what SEP-38 specifies and what the app's converter expects. The
   * amount is still validated, because a caller asking to sell nothing has
   * made a mistake worth reporting rather than answering.
   */
  async prices(input: {sellAsset: string; sellAmount: string}): Promise<{buy_assets: AssetRate[]}> {
    const amount = Number(input.sellAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new PriceUnavailableError('A sell amount must be a positive number');
    }
    if (!this.supportsSellAsset(input.sellAsset)) {
      throw new PriceUnavailableError(`This server does not price ${input.sellAsset}`);
    }

    const rates = await this.ratesFor(input.sellAsset);
    const wanted = rates.filter(
      rate => this.options.buyAssets.includes(rate.asset) && Number(rate.price) > 0,
    );
    // Half a rate table is not a cheaper answer, it is a wrong one: a screen
    // that totals a wallet across currencies would silently drop a holding.
    if (wanted.length === 0) {
      throw new PriceUnavailableError('No rate is available for that asset right now');
    }
    return {buy_assets: wanted};
  }

  /**
   * One upstream read per asset per window, shared by every caller waiting on
   * it. A till with several phones open would otherwise hammer the feed and be
   * rate limited into having no price at all.
   */
  private async ratesFor(sellAsset: string): Promise<AssetRate[]> {
    const now = this.options.now?.() ?? Date.now();
    const cacheMs = this.options.cacheMs ?? 60_000;
    const cached = this.cache.get(sellAsset);
    if (cached && now - cached.readAt < cacheMs) return cached.rates;

    const pending = this.inFlight.get(sellAsset);
    if (pending) return pending;

    const read = (async () => {
      try {
        const rates = await this.options.provider.ratesFor(sellAsset);
        if (rates.length > 0) {
          this.cache.set(sellAsset, {rates, readAt: this.options.now?.() ?? Date.now()});
        }
        return rates;
      } catch (error) {
        // A stale rate is worse than none on a payment screen: it prices a sale
        // at a number the market has already left.
        this.cache.delete(sellAsset);
        throw new PriceUnavailableError(
          error instanceof Error ? error.message : 'The rate feed could not be read',
        );
      } finally {
        this.inFlight.delete(sellAsset);
      }
    })();

    this.inFlight.set(sellAsset, read);
    return read;
  }
}
