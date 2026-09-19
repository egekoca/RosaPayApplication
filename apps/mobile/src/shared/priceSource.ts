import {discoverAnchor, type QuoteSource} from '@rosapay/anchor';
import {payableAssetByCode} from '../features/payments/assets';
import {useAppStore} from '../state/appStore';

/**
 * Where the app asks what money is worth.
 *
 * A rate should come from a real Stellar anchor rather than a number this app
 * invented, and for lira there now is one: a Testnet sandbox that quotes
 * TRY against the same USDC issuer this app already settles in, and that would
 * be the thing actually executing a ramp. Its `/info` and `/prices` need no
 * key, which is what lets a price appear on a merchant's screen before anyone
 * has signed in.
 *
 * It does not price lumens — only USDC — so this deployment's own SEP-38 server
 * still answers for those, from a public market feed. Both speak the standard,
 * so `readCurrencyPrices` cannot tell them apart, and a merchant is simply
 * offered the currencies whichever source can actually quote for the asset
 * they chose. Offering lira against an asset nothing will price is how a
 * merchant finds out at the counter with a customer waiting.
 */
const PRICE_ANCHOR_DOMAIN = 'tr-mock-anchor.fly.dev';

/**
 * The assets the anchor will quote. Everything else falls back to this
 * deployment's own server, which is honest about being a market feed.
 *
 * Kept as a list rather than read from the anchor's `/info` because it decides
 * which of two servers to ask — a lookup that has to happen before either is
 * asked anything.
 */
const ANCHOR_PRICED_ASSETS = new Set([payableAssetByCode('USDC')?.sep38]);

/** Named on any screen that shows a converted amount. */
export const RATE_SOURCE_LABEL = PRICE_ANCHOR_DOMAIN;

/**
 * The currencies a balance can be read in.
 *
 * A flag rather than a code, because the point of the control is to be
 * recognised at a glance while someone is looking at their own money. Lira
 * first: it is what the people this is built for count in.
 */
export const DISPLAY_CURRENCIES = [
  {code: 'TRY', flag: '🇹🇷', name: 'Turkish lira'},
  {code: 'USD', flag: '🇺🇸', name: 'US dollar'},
  {code: 'NGN', flag: '🇳🇬', name: 'Nigerian naira'},
  {code: 'EUR', flag: '🇪🇺', name: 'euro'},
] as const;

export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number]['code'];

/**
 * The mark a currency is written with, where it has one.
 *
 * A price reads faster with its own symbol than with a three-letter code, and
 * lira has a symbol most Turkish screens use. Currencies without one fall back
 * to the code and a space, which is what a code is for.
 */
const SYMBOLS: Record<string, string> = {TRY: '₺', USD: '$', EUR: '€', GBP: '£', NGN: '₦'};

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? `${code} `;
}

export function displayCurrencyMeta(code: string) {
  return DISPLAY_CURRENCIES.find(entry => entry.code === code) ?? DISPLAY_CURRENCIES[0];
}

/** Fallback order when no currency has been chosen yet. */
export const PREFERRED_CURRENCIES = ['TRY', 'USD', 'USDC'];

let discovered: Promise<QuoteSource> | undefined;

/**
 * Resolves the quote server for one sold asset.
 *
 * A discovered anchor and this deployment's own server are the same thing to
 * every caller — a `quoteServer` — which is what kept adding the anchor a
 * configuration change rather than a rewrite.
 *
 * Discovery is cached because it is a `stellar.toml` fetch, and a till that
 * refreshes prices every few minutes should not re-read it each time. A failed
 * discovery falls back rather than leaving the merchant with no currencies at
 * all: an unreachable anchor is a worse reason to lose a sale than a rate from
 * a market feed.
 */
/** This deployment's own SEP-38 server, which prices what no anchor will. */
export function ownQuoteSource(): QuoteSource {
  return {quoteServer: `${useAppStore.getState().apiBaseUrl}/sep38`};
}

export async function resolveQuoteSource(sellAsset?: string, currency?: string): Promise<QuoteSource> {
  const ownServer = ownQuoteSource();
  // The anchor prices lira and nothing else. Asking it for dollars would come
  // back empty and read as "this wallet is worth nothing", so a currency it
  // cannot quote goes to the server that can.
  if (currency && currency !== 'TRY') return ownServer;
  if (!sellAsset || !ANCHOR_PRICED_ASSETS.has(sellAsset)) return ownServer;

  discovered ??= discoverAnchor(PRICE_ANCHOR_DOMAIN).catch(error => {
    discovered = undefined;
    throw error;
  });
  return discovered.catch(() => ownServer);
}
