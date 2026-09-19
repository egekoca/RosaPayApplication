import {assertPayableAmount, IS_SANDBOX_ANCHOR, LiraRampError} from '../src/features/wallet/liraRamp';

/**
 * The device prompt is what this flow spends of a customer's patience, and it
 * comes before the anchor is told anything. An amount that was never going to
 * work has to be refused ahead of it — otherwise someone gives a fingerprint,
 * waits through a sign-in, has a withdrawal opened in their name, and is then
 * told "the network rejected the payment", which is true and explains nothing.
 */
describe('what the lira ramp will accept', () => {
  it('takes a plain positive amount', () => {
    expect(assertPayableAmount('500', {unit: 'TRY'})).toBe(500);
    expect(assertPayableAmount('10.2723888', {unit: 'USDC'})).toBeCloseTo(10.2723888, 7);
  });

  it('refuses nothing, zero and anything that is not a number', () => {
    for (const bad of ['', '   ', '0', '-5', 'abc', 'NaN']) {
      expect(() => assertPayableAmount(bad, {unit: 'TRY'})).toThrow(LiraRampError);
    }
  });

  /** Cashing out more than the wallet holds fails on chain after the prompt. */
  it('refuses more than the wallet holds, and says how much there is', () => {
    expect(() => assertPayableAmount('50', {available: '10.27', unit: 'USDC'})).toThrow(
      /You hold 10\.27 USDC/,
    );
    expect(assertPayableAmount('10.27', {available: '10.27', unit: 'USDC'})).toBeCloseTo(10.27, 2);
  });

  it('does not check a balance it was not given', () => {
    // Adding money is limited by the customer's bank, not by this wallet.
    expect(assertPayableAmount('250000', {unit: 'TRY'})).toBe(250000);
  });

  /**
   * The "simulate the bank transfer" button posts to an endpoint only the
   * sandbox has. Against a real anchor it would sit next to a customer who has
   * to actually send the money, offering to pretend for them.
   */
  it('knows whether its anchor has a bank that can pretend', () => {
    expect(IS_SANDBOX_ANCHOR).toBe(true);
  });
});
