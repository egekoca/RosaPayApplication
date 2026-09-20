import {useEffect, useState} from 'react';

/** Stellar closes a ledger about every five seconds. */
export const LEDGER_SECONDS = 5;

/**
 * Seconds left, counted down between ledger observations.
 *
 * The ledger is the authority and arrives every few seconds, which is too
 * coarse to watch: a number that jumps in fives reads as broken. So each fresh
 * observation sets the clock and the seconds in between are counted locally —
 * the display is smooth and never drifts far from what the chain says, because
 * the next observation corrects it.
 *
 * Both sides of the counter read this. The merchant is deciding whether the
 * code on the table is still worth showing; the customer is deciding whether
 * to approve before it stops being payable, which is the more pressing of the
 * two and had nothing but a ledger count to go on.
 */
export function useLedgerCountdown(remainingLedgers: number | undefined): number | undefined {
  const [seconds, setSeconds] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (remainingLedgers === undefined) {
      setSeconds(undefined);
      return;
    }
    setSeconds(Math.max(0, remainingLedgers * LEDGER_SECONDS));
    const timer = setInterval(() => {
      setSeconds(value => (value === undefined ? value : Math.max(0, value - 1)));
    }, 1_000);
    return () => clearInterval(timer);
  }, [remainingLedgers]);

  return seconds;
}

/** `4:05`, the way a countdown is read. */
export function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
