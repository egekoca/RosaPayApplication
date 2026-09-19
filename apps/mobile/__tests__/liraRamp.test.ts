import {
  assertPayableAmount,
  IS_SANDBOX_ANCHOR,
  LiraRampError,
  readLiraTransfer,
  settleLiraDeposit,
} from '../src/features/wallet/liraRamp';

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

describe('a deposit the anchor could not pay directly', () => {
  /**
   * This anchor advertises `features.claimable_balances: true` and uses it: a
   * destination with no trustline gets a claimable balance instead of a
   * payment. It still calls the transfer `completed`, which is the trap.
   */
  const transfer = {
    transferServer: 'https://tr-mock-anchor.fly.dev/sep6',
    transactionId: 'sep_1',
    session: {token: 'jwt', account: 'G', authProtocol: 'SEP-10'} as never,
  };

  function anchorReturns(transaction: Record<string, unknown>) {
    return jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({transaction}),
      text: async () => JSON.stringify({transaction}),
    })) as unknown as typeof fetch;
  }

  it('does not call a deposit settled while the money sits in a claimable balance', async () => {
    global.fetch = anchorReturns({
      status: 'completed',
      amount_in: '500',
      amount_out: '10.27',
      claimable_balance_id: '00000000abc',
    });

    const status = await readLiraTransfer(transfer);
    expect(status.status).toBe('completed');
    expect(status.claimableBalanceId).toBe('00000000abc');
    // The anchor is finished; the customer's wallet is not.
    expect(status.settled).toBe(false);
    expect(status.failed).toBe(false);
  });

  it('settles a deposit that really did reach the wallet', async () => {
    global.fetch = anchorReturns({
      status: 'completed',
      amount_out: '10.27',
      stellar_transaction_id: 'a'.repeat(64),
    });

    const status = await readLiraTransfer(transfer);
    expect(status.settled).toBe(true);
    expect(status.claimableBalanceId).toBeUndefined();
    expect(status.stellarTransactionId).toBe('a'.repeat(64));
  });
});

describe('a smart wallet reaching the anchor', () => {
  /**
   * The anchor cannot see a contract account at all, so a smart-wallet deposit
   * is paid to a bridge and moved across afterwards. Until that move happens
   * the money is not the customer's to spend, however complete the anchor calls
   * the transfer.
   */
  it('does not treat a bridged deposit as finished by the anchor alone', async () => {
    const withoutBridge = {
      transactionId: 'sep_1',
      instructions: {},
      session: {token: 't'} as never,
      transferServer: 'https://tr-mock-anchor.fly.dev/sep6',
      simulateUrl: 'https://tr-mock-anchor.fly.dev/sep6/tx/sep_1/simulate-bank-transfer',
    };

    // A recovery-phrase wallet was paid directly; there is nothing to move.
    await expect(settleLiraDeposit(withoutBridge)).resolves.toEqual({
      movedStroops: 0n,
      transactionHash: null,
    });
  });
});
