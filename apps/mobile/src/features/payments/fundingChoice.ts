import type {PaymentIntentV1} from '@rosapay/protocol';
import {
  assetContractId,
  formatStroops,
  parseStroops,
  quoteSwapFunding,
  readAssetBalance,
  type SettlementFunding,
  type StellarConfig,
} from '@rosapay/stellar';

import {payableAssets, type PayableAsset} from './assets';

/**
 * Deciding what a customer pays with.
 *
 * A merchant prices a coffee in USDC and the customer's wallet holds lumens.
 * Until now that was simply a dead end: the settlement contract moves one named
 * token, so a zero balance of that token meant no payment. The contract can now
 * buy the shortfall through Soroswap on the way past, which turns the dead end
 * into a question - *which of the moneys you hold should this come out of?*
 *
 * This module answers it before anyone is asked to approve anything, because
 * the number that matters to the person at the counter is not the merchant's
 * price. It is what leaves their own wallet.
 */

export type FundingOption =
  | {
      kind: 'direct';
      /** The merchant's own asset, which this wallet already holds enough of. */
      asset: PayableAsset;
      /** What the customer will spend, which is the price itself. */
      spend: string;
      held: string;
    }
  | {
      kind: 'swap';
      asset: PayableAsset;
      /** Soroswap's quote, in the customer's asset. */
      spend: string;
      /** The ceiling carried into the contract call. */
      maxSpend: string;
      held: string;
      /** For example `9.4658320 XLM per USDC`. */
      rate: string;
      funding: SettlementFunding;
    }
  | {
      kind: 'unavailable';
      asset: PayableAsset;
      held: string;
      reason: 'INSUFFICIENT' | 'NO_ROUTE';
    };

export type FundingChoice = {
  /** Every payable asset, in the order they should be offered. */
  options: FundingOption[];
  /** The first option that can actually settle, if there is one. */
  recommended: FundingOption | undefined;
};

export type FundingChoiceInput = {
  intent: PaymentIntentV1;
  config: StellarConfig;
  /** The paying account, classic or contract. */
  customerAddress: string;
  routerContractId: string;
  /** Headroom over the quote; the contract refuses to spend above it. */
  slippageBps?: number;
  readBalance?: typeof readAssetBalance;
  quote?: typeof quoteSwapFunding;
};

/**
 * What this wallet could pay this request with, priced.
 *
 * Direct payment always sorts first: a customer holding the merchant's own
 * token should never be routed through a pool and charged a spread for it.
 * After that the order is whatever `payableAssets` lists, so the offer is
 * stable rather than reordering itself as balances move.
 */
export async function resolveFundingChoice(input: FundingChoiceInput): Promise<FundingChoice> {
  const {networkPassphrase} = input.config;
  const readBalance = input.readBalance ?? readAssetBalance;
  const quote = input.quote ?? quoteSwapFunding;
  const settlementToken = assetContractId(input.intent.asset, networkPassphrase);
  const amountOut = parseStroops(input.intent.amount);

  const options: FundingOption[] = [];
  for (const asset of payableAssets) {
    const contractId = assetContractId(asset.asset, networkPassphrase);
    // A balance that cannot be read is a balance of zero for this purpose: a
    // classic account without a trustline holds none of the asset, and an
    // unreachable RPC must not make an option look affordable.
    const held = await readBalance(input.config, input.customerAddress, contractId).catch(() => '0');
    const heldStroops = parseStroops(held);

    if (contractId === settlementToken) {
      options.push(
        heldStroops >= amountOut
          ? {kind: 'direct', asset, spend: input.intent.amount, held}
          : {kind: 'unavailable', asset, held, reason: 'INSUFFICIENT'},
      );
      continue;
    }
    if (heldStroops === 0n) {
      options.push({kind: 'unavailable', asset, held, reason: 'INSUFFICIENT'});
      continue;
    }

    let priced;
    try {
      priced = await quote({
        config: input.config,
        routerContractId: input.routerContractId,
        path: [contractId, settlementToken],
        settlementToken,
        amountOut,
        ...(input.slippageBps === undefined ? {} : {slippageBps: input.slippageBps}),
      });
    } catch {
      options.push({
        kind: 'unavailable',
        asset,
        held,
        // A pool that does not exist and one that cannot price this size are
        // the same answer at the counter: not with this money.
        reason: 'NO_ROUTE',
      });
      continue;
    }

    // The ceiling is what the wallet must cover, not the quote: a payment that
    // is offered and then refused for insufficient funds is worse than one that
    // was never offered.
    if (heldStroops < priced.amountInMax) {
      options.push({kind: 'unavailable', asset, held, reason: 'INSUFFICIENT'});
      continue;
    }

    options.push({
      kind: 'swap',
      asset,
      spend: formatStroops(priced.amountIn),
      maxSpend: formatStroops(priced.amountInMax),
      held,
      rate: describeRate(priced.amountIn, amountOut, asset.code, input.intent.asset.code),
      funding: {
        path: priced.path,
        amountInMax: priced.amountInMax,
        // Five minutes is long enough for a person to read the screen and press
        // a button, and short enough that an approval left on a table does not
        // execute against a pool that has moved since.
        deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
      },
    });
  }

  const order = {direct: 0, swap: 1, unavailable: 2} as const;
  options.sort((left, right) => order[left.kind] - order[right.kind]);
  return {options, recommended: options.find(option => option.kind !== 'unavailable')};
}

/** `9.4658320 XLM per USDC`, at seven places, without crossing a float. */
export function describeRate(
  amountIn: bigint,
  amountOut: bigint,
  inCode: string,
  outCode: string,
): string {
  if (amountOut <= 0n) return '';
  const scaled = (amountIn * 10_000_000n) / amountOut;
  return `${formatStroops(scaled)} ${inCode} per ${outCode}`;
}
