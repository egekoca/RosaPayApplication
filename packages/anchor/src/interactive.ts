import {z} from 'zod';
import type {AnchorInfo} from './stellarToml';
import type {SessionToken} from './webAuth';

/**
 * SEP-24, the hosted deposit and withdrawal flow. The anchor returns a URL that
 * Lumenade Pay opens; the anchor collects KYC, the amount and the payment details on
 * its own pages.
 *
 * That is the point of choosing SEP-24 over SEP-6: identity documents and bank
 * details are the anchor's regulated business, and Lumenade Pay is better off never
 * holding them.
 */
export type InteractiveKind = 'deposit' | 'withdraw';

export type InteractiveSession = {
  /** Open this in a browser the customer can see is the anchor's. */
  url: string;
  transactionId: string;
};

export const anchorTransactionStatuses = [
  'incomplete',
  'pending_user_transfer_start',
  'pending_user_transfer_complete',
  'pending_external',
  'pending_anchor',
  'pending_stellar',
  'pending_trust',
  'pending_user',
  'on_hold',
  'completed',
  'refunded',
  'expired',
  'no_market',
  'too_small',
  'too_large',
  'error',
] as const;

export type AnchorTransactionStatus = (typeof anchorTransactionStatuses)[number];

export const anchorTransactionSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  status: z.enum(anchorTransactionStatuses),
  amount_in: z.string().optional(),
  amount_out: z.string().optional(),
  amount_fee: z.string().optional(),
  stellar_transaction_id: z.string().optional(),
  external_transaction_id: z.string().optional(),
  more_info_url: z.string().optional(),
  message: z.string().optional(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  status_eta: z.number().int().nonnegative().optional(),
  user_action_required_by: z.string().optional(),
  /** Present on a withdrawal: where the customer's asset must be sent. */
  withdraw_anchor_account: z.string().optional(),
  withdraw_memo: z.string().optional(),
  withdraw_memo_type: z.string().optional(),
});

export type AnchorTransaction = z.infer<typeof anchorTransactionSchema>;

export type InteractiveErrorCode =
  | 'TRANSFER_UNSUPPORTED'
  | 'INTERACTIVE_REFUSED'
  | 'UNTRUSTED_URL'
  | 'UNKNOWN_TRANSACTION'
  | 'POLL_ABORTED';

export class InteractiveError extends Error {
  override readonly name = 'InteractiveError';
  constructor(readonly code: InteractiveErrorCode, message: string) {
    super(message);
  }
}

/**
 * Whether a URL is safe to open for this anchor.
 *
 * The interactive URL is chosen by the anchor, and Lumenade Pay opens it in a
 * browser holding a session the customer trusts. A URL pointing anywhere else is
 * a way to put a convincing page in front of someone mid-payment, so it is
 * refused rather than opened.
 */
export function isTrustedAnchorUrl(
  url: string,
  anchor: AnchorInfo,
  trustedInteractiveOrigins: readonly string[] = [],
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  const domain = anchor.homeDomain.toLowerCase();
  // The anchor's own domain, or a subdomain of it.
  if (host === domain || host.endsWith(`.${domain}`)) return true;

  // Some anchors host their regulated UI on a separate origin. Never infer
  // trust from a shared registrable domain (for example every *.stellar.org
  // host); require the wallet's deployment configuration to name the exact
  // HTTPS origin instead.
  return trustedInteractiveOrigins.some(candidate => {
    try {
      const allowed = new URL(candidate);
      return allowed.protocol === 'https:' && allowed.origin.toLowerCase() === parsed.origin.toLowerCase();
    } catch {
      return false;
    }
  });
}

export type InteractiveInput = {
  anchor: AnchorInfo;
  session: SessionToken;
  kind: InteractiveKind;
  assetCode: string;
  assetIssuer?: string;
  /** Where a deposit should land, or which account funds a withdrawal. */
  account?: string;
  amount?: string;
  /** Exact HTTPS origins approved by deployment configuration for hosted UI. */
  trustedInteractiveOrigins?: readonly string[];
  fetcher?: typeof fetch;
};

export async function startInteractive(input: InteractiveInput): Promise<InteractiveSession> {
  const {anchor, session, kind, fetcher = fetch} = input;
  if (!anchor.transferServerSep24) {
    throw new InteractiveError(
      'TRANSFER_UNSUPPORTED',
      `${anchor.homeDomain} does not offer hosted deposits or withdrawals`,
    );
  }

  const body: Record<string, string> = {asset_code: input.assetCode};
  if (input.assetIssuer) body.asset_issuer = input.assetIssuer;
  if (input.account ?? session.account) body.account = input.account ?? session.account;
  if (input.amount) body.amount = input.amount;

  let payload: {url?: string; id?: string; error?: string};
  try {
    const response = await fetcher(`${anchor.transferServerSep24}/transactions/${kind}/interactive`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify(body),
    });
    payload = (await response.json()) as typeof payload;
    if (!response.ok || !payload.url || !payload.id) {
      throw new InteractiveError(
        'INTERACTIVE_REFUSED',
        payload.error ?? `${anchor.homeDomain} would not start this ${kind}`,
      );
    }
  } catch (error) {
    if (error instanceof InteractiveError) throw error;
    throw new InteractiveError('INTERACTIVE_REFUSED', `${anchor.homeDomain} could not be reached`);
  }

  if (!isTrustedAnchorUrl(payload.url!, anchor, input.trustedInteractiveOrigins)) {
    let refusedOrigin = 'an invalid URL';
    try {
      refusedOrigin = new URL(payload.url!).origin;
    } catch {
      // Keep the full attacker-controlled value out of the error and logs.
    }
    throw new InteractiveError(
      'UNTRUSTED_URL',
      `The anchor asked Lumenade Pay to open ${refusedOrigin}, so it was not opened`,
    );
  }

  return {url: payload.url!, transactionId: payload.id!};
}

export type TransactionQuery = {
  anchor: AnchorInfo;
  session: SessionToken;
  transactionId: string;
  fetcher?: typeof fetch;
};

/** Reads where a deposit or withdrawal has got to. */
export async function readTransaction(query: TransactionQuery): Promise<AnchorTransaction> {
  const {anchor, session, transactionId, fetcher = fetch} = query;
  if (!anchor.transferServerSep24) {
    throw new InteractiveError('TRANSFER_UNSUPPORTED', `${anchor.homeDomain} has no transfer server`);
  }

  const url = new URL(`${anchor.transferServerSep24}/transaction`);
  url.searchParams.set('id', transactionId);

  try {
    const response = await fetcher(url.toString(), {
      headers: {authorization: `Bearer ${session.token}`},
    });
    if (!response.ok) {
      throw new InteractiveError('UNKNOWN_TRANSACTION', `${anchor.homeDomain} does not know that transaction`);
    }
    const body = (await response.json()) as {transaction?: unknown};
    const parsed = anchorTransactionSchema.safeParse(body.transaction);
    if (!parsed.success) {
      throw new InteractiveError(
        'UNKNOWN_TRANSACTION',
        `${anchor.homeDomain} returned a transaction Lumenade Pay cannot read`,
      );
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof InteractiveError) throw error;
    throw new InteractiveError('UNKNOWN_TRANSACTION', `${anchor.homeDomain} could not report that transaction`);
  }
}

/** Whether a status means the customer has to go back to the anchor's pages. */
export function needsCustomerAction(status: AnchorTransactionStatus): boolean {
  return [
    'incomplete',
    'pending_user',
    'pending_user_transfer_start',
    'pending_user_transfer_complete',
    'pending_trust',
  ].includes(status);
}

/** Whether a status means nothing further will happen. */
export function isFinal(status: AnchorTransactionStatus): boolean {
  return ['completed', 'refunded', 'expired', 'error', 'no_market', 'too_small', 'too_large'].includes(status);
}

export type AnchorTransactionPhase = 'action_required' | 'pending' | 'completed' | 'failed';

/** Collapses the SEP-24 wire statuses into the four states the wallet presents. */
export function transactionPhase(status: AnchorTransactionStatus): AnchorTransactionPhase {
  if (status === 'completed') return 'completed';
  if (needsCustomerAction(status)) return 'action_required';
  if (isFinal(status)) return 'failed';
  return 'pending';
}

export type PollTransactionOptions = TransactionQuery & {
  /** Includes the first read. */
  attempts?: number;
  intervalMs?: number;
  signal?: AbortSignal;
  onUpdate?: (transaction: AnchorTransaction) => void;
  /** Test seam; production uses a timer. */
  sleep?: (milliseconds: number) => Promise<void>;
};

/**
 * Follows an anchor transaction until it finishes, needs customer input, or the
 * bounded polling window ends. A non-final result is returned on timeout so the
 * app can persist the transaction id and resume later instead of turning a slow
 * bank rail into a false failure.
 */
export async function pollTransaction({
  attempts = 30,
  intervalMs = 2_000,
  signal,
  onUpdate,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  ...query
}: PollTransactionOptions): Promise<AnchorTransaction> {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new RangeError('Polling attempts must be a positive integer');
  }
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    throw new RangeError('Polling interval must be zero or greater');
  }

  let latest: AnchorTransaction | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal?.aborted) {
      throw new InteractiveError('POLL_ABORTED', 'Following the anchor transaction was cancelled');
    }
    latest = await readTransaction(query);
    onUpdate?.(latest);
    if (isFinal(latest.status) || needsCustomerAction(latest.status) || attempt === attempts - 1) return latest;
    await sleep(intervalMs);
  }

  // The positive-attempt guard makes this unreachable, but keeps the return
  // type honest if the loop is ever refactored.
  throw new InteractiveError('UNKNOWN_TRANSACTION', 'The anchor transaction could not be read');
}

export const nativeAsset = 'stellar:native';

export type IndicativePrice = {
  /** SEP-38 asset identifier, e.g. `iso4217:USD` or `stellar:USDC:G…`. */
  asset: string;
  /**
   * Exactly as SEP-38 defines it: units of the **sold** asset for one unit of
   * this bought asset. Selling USDC to buy lira quotes ~0.0207, because one
   * lira costs about two cents — not 48, which is the same rate read backwards.
   */
  price: string;
  decimals?: number;
};

/**
 * Where SEP-38 prices are read from. An `AnchorInfo` satisfies it, so a
 * discovered anchor can still be passed straight in.
 */
export type QuoteSource = {quoteServer?: string};

/**
 * SEP-38 indicative prices: what a quote server would give for an asset now.
 *
 * Indicative, not a quote — it commits the server to nothing and is only good
 * for telling someone roughly what their balance is worth. A firm number needs
 * `/quote`, which requires an authenticated session and reserves a rate.
 *
 * The source is a quote server, not a whole anchor, because the two are not the
 * same thing. Discovering an anchor is how you find one; it is not the only way
 * to have one, and a deployment whose currency no anchor will price has to be
 * able to point this somewhere else without the callers changing.
 */
export async function readIndicativePrices(input: {
  source: QuoteSource;
  sellAsset?: string;
  sellAmount: string;
  fetcher?: typeof fetch;
}): Promise<IndicativePrice[]> {
  const {source, sellAsset = nativeAsset, sellAmount, fetcher = fetch} = input;
  const {quoteServer} = source;
  if (!quoteServer) return [];

  const url = new URL(`${quoteServer}/prices`);
  url.searchParams.set('sell_asset', sellAsset);
  url.searchParams.set('sell_amount', sellAmount);

  const response = await fetcher(url.toString());
  if (!response.ok) return [];

  const body = (await response.json()) as {buy_assets?: unknown};
  const parsed = z
    .array(
      z.object({
        asset: z.string().min(1),
        price: z.string().min(1),
        decimals: z.number().optional(),
      }),
    )
    .safeParse(body.buy_assets);
  return parsed.success ? parsed.data : [];
}

/** The human label an anchor's asset identifier stands for, e.g. `USD`. */
export function assetCodeOf(asset: string): string {
  const [scheme, code] = asset.split(':');
  if (scheme === 'iso4217') return code ?? asset;
  // `stellar:native` is the lumen; every other stellar asset names its code.
  if (scheme === 'stellar') return !code || code === 'native' ? 'XLM' : code;
  return asset;
}

export type CurrencyPrice = {
  /** The currency a merchant would name a price in, e.g. `USD`. */
  currency: string;
  /** SEP-38 identifier the anchor used, kept so a quote can be requested later. */
  asset: string;
  /**
   * How many units of `currency` one unit of the sold asset is worth — the
   * inverse of what SEP-38 sends, and the direction a person reads: "8.97 lira
   * per lumen", not "0.11 lumens per lira".
   *
   * The flip happens here, once, at the edge. It used to not happen at all,
   * which went unnoticed because this app was also serving its own prices in
   * the inverted direction — both sides wrong in the same way agree. Against a
   * real anchor a 500 lira coffee came out as 24,095 USDC.
   */
  perUnit: string;
};

/**
 * The currencies an anchor will price an asset in.
 *
 * A merchant thinks in the money on their menu, not in lumens. This asks the
 * anchor which of those currencies it can actually price, so the app offers the
 * real list rather than a hardcoded one that may quote nothing.
 */
export async function readCurrencyPrices(input: {
  source: QuoteSource;
  sellAsset?: string;
  fetcher?: typeof fetch;
}): Promise<CurrencyPrice[]> {
  const prices = await readIndicativePrices({
    source: input.source,
    sellAsset: input.sellAsset ?? nativeAsset,
    sellAmount: '1',
    ...(input.fetcher ? {fetcher: input.fetcher} : {}),
  });

  return prices
    .filter(price => Number(price.price) > 0)
    .map(price => ({
      currency: assetCodeOf(price.asset),
      asset: price.asset,
      perUnit: invert(price.price),
    }));
}

/**
 * Turns SEP-38's sell-per-buy into the buy-per-sell a menu price is read in.
 *
 * Done in decimal rather than as `1 / x` on a float, and at more places than a
 * price is ever displayed to, because this number multiplies a sale.
 */
function invert(price: string): string {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) return '0';
  return (1 / value).toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
}

export class PriceConversionError extends Error {}

/**
 * How much of the asset settles a price named in a currency.
 *
 * Rounded up, never down: rounding down would hand the merchant fractionally
 * less than the price on their menu, and doing that on every payment is a
 * shortfall they never agreed to. Stellar amounts carry seven decimals, so that
 * is the precision the result is emitted at.
 */
export function assetAmountForPrice(input: {
  amount: string;
  perUnit: string;
  decimals?: number;
}): string {
  const decimals = input.decimals ?? 7;
  const amount = Number(input.amount);
  const perUnit = Number(input.perUnit);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PriceConversionError('A price must be a positive amount');
  }
  if (!Number.isFinite(perUnit) || perUnit <= 0) {
    throw new PriceConversionError('A rate must be a positive number');
  }

  const scale = 10 ** decimals;
  const units = Math.ceil((amount / perUnit) * scale);
  if (!Number.isFinite(units)) {
    throw new PriceConversionError('That price does not convert to a payable amount');
  }
  return (units / scale).toFixed(decimals);
}
