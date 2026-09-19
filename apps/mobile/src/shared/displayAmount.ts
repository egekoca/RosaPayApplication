/** Stellar carries seven decimal places, and nothing displayed goes past them. */
const STELLAR_DECIMALS = 7;

/**
 * How an amount is read, not how it is settled.
 *
 * A rate conversion uses every place Stellar has: 500 lira at 13.4 comes back
 * as 37.3134329 XLM. That is the right number to sign and the wrong number to
 * show. Five digits of dust carry no meaning to the person holding the phone,
 * and at the size an amount is set on a payment screen they do not fit on it.
 * The exact string stays in the signed payload; this is only what is read.
 *
 * Small amounts are the exception. Rounding 0.0004 down to "0.00" would say the
 * payment is free, so the display keeps widening until a digit survives.
 */
export function displayAmount(amount: string | number, decimals = 2): string {
  const raw = typeof amount === 'number' ? amount : amount.trim();
  // Blank is not zero. `Number('')` says otherwise, and a screen that prints
  // "0.00" where nothing was given has invented an amount.
  if (raw === '') return '';
  const value = Number(raw);
  if (!Number.isFinite(value)) return String(raw);

  let places = Math.min(Math.max(Math.trunc(decimals), 0), STELLAR_DECIMALS);
  while (value !== 0 && places < STELLAR_DECIMALS && Number(value.toFixed(places)) === 0) {
    places += 1;
  }
  return groupThousands(value.toFixed(places));
}

/** A four-figure balance is a wall of digits without them. */
function groupThousands(fixed: string): string {
  const [whole = '0', fraction] = fixed.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const grouped = (sign ? whole.slice(1) : whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`;
}

/**
 * The amount exactly as it will be signed, only made legible.
 *
 * Anywhere a person is approving a figure — or showing one for someone else to
 * approve — the number on screen has to be the number in the payload. A
 * fiat-priced request settles at something like 37.3134329 XLM, and rounding
 * that to 37.31 next to the words "your device will authorize this exact
 * amount" makes the screen contradict itself. Grouping is added because it aids
 * reading without changing the value; nothing else is.
 */
export function exactAmount(amount: string): string {
  const raw = amount.trim();
  if (raw === '') return '';
  if (!Number.isFinite(Number(raw))) return raw;

  const [whole = '0', fraction] = raw.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const grouped = (sign ? whole.slice(1) : whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // Trailing zeros are dropped: "24.5000000" is the same amount as "24.5" and
  // the shorter one is the one a person can check against a bill.
  const trimmed = fraction?.replace(/0+$/, '');
  return trimmed ? `${sign}${grouped}.${trimmed}` : `${sign}${grouped}`;
}
