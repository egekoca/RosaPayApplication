import {clock, LEDGER_SECONDS} from '../src/shared/ledgerCountdown';

describe('the clock over a payment request', () => {
  it('reads as minutes and seconds, zero-padded', () => {
    expect(clock(245)).toBe('4:05');
    expect(clock(60)).toBe('1:00');
    expect(clock(9)).toBe('0:09');
    expect(clock(0)).toBe('0:00');
  });

  it('never rounds up into time that is not there', () => {
    // A request with 59 seconds left must not read as a minute: the whole
    // point of the clock is knowing whether there is time to approve.
    expect(clock(59)).toBe('0:59');
    expect(clock(119)).toBe('1:59');
  });

  it('turns the ledgers a request has left into seconds', () => {
    // Five minutes is sixty ledgers, which is what the merchant's request
    // lifetime is set from at the other end.
    expect(60 * LEDGER_SECONDS).toBe(300);
    expect(clock(60 * LEDGER_SECONDS)).toBe('5:00');
  });
});
