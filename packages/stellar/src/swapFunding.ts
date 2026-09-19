import {Client as SoroswapRouterClient} from './generated/soroswapRouter';
import type {StellarConfig} from './config';

/**
 * Pricing a payment the customer cannot fund directly.
 *
 * A merchant asks for USDC; the customer holds XLM. The settlement contract
 * moves one named token, so without a swap the payment cannot happen at all.
 * This module answers the only question the customer needs before approving:
 * *what will this cost me, in the money I actually have?*
 *
 * The quote is a simulation of Soroswap's `router_get_amounts_in`, which walks
 * the same reserves the swap itself will walk. It is a forecast, not a promise:
 * the pool can move between the quote and the ledger. Two separate things stop
 * that from costing the customer anything they did not agree to.
 *
 * 1. `amountInMax`, the ceiling carried into the contract call. The router
 *    refuses above it, and the whole payment fails rather than overspending.
 * 2. The authorization entry itself. The customer's signature covers the exact
 *    input transfer the swap will make, so a pool that moves invalidates the
 *    signature and the transaction is rejected. This is stricter than the
 *    ceiling and is why a moved pool reads as "try again" rather than a
 *    surprise on the receipt.
 */

/** Soroswap's own quote, plus what it means for the person approving it. */
export type SwapFundingQuote = {
  /** Contract addresses, input first, ending at the token the merchant asked for. */
  path: string[];
  /** Stroops of `path[0]` the pool wants right now. */
  amountIn: bigint;
  /** Stroops of the merchant's token, unchanged from the signed intent. */
  amountOut: bigint;
  /** `amountIn` plus slippage: what the contract call is allowed to spend. */
  amountInMax: bigint;
  /** The fraction `amountInMax` sits above `amountIn`, as it was requested. */
  slippageBps: number;
};

export class SwapFundingError extends Error {
  override readonly name = 'SwapFundingError';

  constructor(
    readonly code: 'NO_ROUTE' | 'INVALID_PATH' | 'INVALID_AMOUNT' | 'QUOTE_FAILED',
    message: string,
  ) {
    super(message);
  }
}

export type SwapFundingQuoteInput = {
  config: StellarConfig;
  /** The AMM router, which the settlement contract also holds in its own storage. */
  routerContractId: string;
  /** Input token first, the merchant's token last. */
  path: string[];
  /**
   * The token the merchant asked to be paid in, taken separately from the path
   * on purpose. Reading it off the end of the path would only ever confirm the
   * path agrees with itself; passing it from the intent is what makes the check
   * mean anything.
   */
  settlementToken: string;
  /** Exactly what the merchant signed for, in stroops. */
  amountOut: bigint;
  /**
   * Headroom over the quote. Defaults to 50 bps, which is wide enough for an
   * ordinary block of pool movement and narrow enough that a customer reading
   * the number is not agreeing to something else.
   */
  slippageBps?: number;
  /** Injectable for tests; defaults to the generated router client. */
  quoteAmountsIn?(path: string[], amountOut: bigint): Promise<bigint[]>;
};

export const DEFAULT_SWAP_SLIPPAGE_BPS = 50;

/** Rejects a path that could buy the wrong thing, before anything is quoted. */
export function assertFundingPath(path: string[], settlementToken: string): void {
  if (path.length < 2) {
    throw new SwapFundingError('INVALID_PATH', 'A funding path needs at least an input and an output token');
  }
  if (path[path.length - 1] !== settlementToken) {
    throw new SwapFundingError(
      'INVALID_PATH',
      'A funding path must end at the token the merchant asked to be paid in',
    );
  }
  if (path[0] === settlementToken) {
    throw new SwapFundingError(
      'INVALID_PATH',
      'A funding path that starts where it ends buys nothing and only costs a fee',
    );
  }
}

/** What the customer will spend to settle `amountOut` of the merchant's token. */
export async function quoteSwapFunding(input: SwapFundingQuoteInput): Promise<SwapFundingQuote> {
  assertFundingPath(input.path, input.settlementToken);
  if (input.amountOut <= 0n) {
    throw new SwapFundingError('INVALID_AMOUNT', 'A payment amount must be positive');
  }
  const slippageBps = input.slippageBps ?? DEFAULT_SWAP_SLIPPAGE_BPS;
  if (slippageBps < 0 || slippageBps > 10_000) {
    throw new SwapFundingError('INVALID_AMOUNT', 'Slippage must be between 0 and 10000 basis points');
  }

  const quote = input.quoteAmountsIn ?? createRouterQuoter(input.config, input.routerContractId);
  let amounts: bigint[];
  try {
    amounts = await quote(input.path, input.amountOut);
  } catch (error) {
    // A pool that does not exist and a router that is unreachable both arrive
    // here. Neither is something the customer can act on differently, and both
    // mean the same thing at the counter: this token cannot pay this bill.
    throw new SwapFundingError(
      'NO_ROUTE',
      error instanceof Error ? error.message : 'Soroswap could not price this route',
    );
  }
  const amountIn = amounts[0];
  if (amountIn === undefined || amountIn <= 0n) {
    throw new SwapFundingError('NO_ROUTE', 'Soroswap returned no input amount for this route');
  }

  return {
    path: [...input.path],
    amountIn,
    amountOut: input.amountOut,
    // Integer arithmetic throughout: a payment ceiling must never round through
    // a float.
    amountInMax: (amountIn * BigInt(10_000 + slippageBps)) / 10_000n,
    slippageBps,
  };
}

function createRouterQuoter(
  config: StellarConfig,
  routerContractId: string,
): (path: string[], amountOut: bigint) => Promise<bigint[]> {
  return async (path, amountOut) => {
    const client = new SoroswapRouterClient({
      contractId: routerContractId,
      networkPassphrase: config.networkPassphrase,
      rpcUrl: config.rpcUrl,
      // A view call still needs a source account to simulate against; the
      // router reads reserves and never this account.
      publicKey: undefined,
      allowHttp: config.rpcUrl.startsWith('http://'),
    });
    const assembled = await client.router_get_amounts_in({amount_out: amountOut, path}, {simulate: true});
    const result = assembled.result;
    if (result.isErr()) {
      throw new SwapFundingError('QUOTE_FAILED', `Soroswap rejected the quote: ${String(result.unwrapErr())}`);
    }
    return [...result.unwrap()];
  };
}
