import {SecureSignerError} from '@rosapay/secure-signer';
import {SettlementPipelineError, SettlementServiceError} from '@rosapay/stellar';
import {OfflineCustomerError} from '../src/features/payments/offlineCustomer';
import {describeSettlementError, settlementErrorDetail} from '../src/features/payments/settlementErrors';
import {TestnetSettlementError} from '../src/features/payments/testnetSettlement';

describe('settlement error messages', () => {
  it('explains a settled or expired request instead of leaking internals', () => {
    const message = describeSettlementError(
      new SettlementPipelineError('CUSTOMER_AUTH_REQUIRED', 'Settlement simulation did not produce a customer authorization entry'),
    );
    expect(message).toContain('already settled or expired');
  });

  it('names the missing relayer and the missing merchant signature', () => {
    expect(describeSettlementError(new TestnetSettlementError('RELAYER_UNAVAILABLE', 'x'))).toContain('relayer is unreachable');
    // Each of these is raised with its own sentence naming a different next
    // move — wait, ask for a new request, fix the deployment — so the mapper
    // passes it through instead of flattening them into one.
    expect(
      describeSettlementError(
        new TestnetSettlementError('MERCHANT_KEY_UNAVAILABLE', 'Someone else is already paying this request.'),
      ),
    ).toBe('Someone else is already paying this request.');
    expect(describeSettlementError(new TestnetSettlementError('MERCHANT_KEY_UNAVAILABLE', ''))).toContain(
      'could not approve',
    );
    expect(describeSettlementError(new SettlementServiceError('INVALID_MERCHANT_SIGNATURE', 'x'))).toContain('does not match');
  });

  it('names funding and connectivity failures from the network message', () => {
    expect(describeSettlementError(new Error('tx_insufficient_balance'))).toContain('enough XLM');
    expect(describeSettlementError(new Error('Account not found'))).toContain('not funded');
    expect(describeSettlementError(new Error('Request timeout'))).toContain('could not be reached');
  });

  it('never claims a partial success for an unknown failure', () => {
    expect(describeSettlementError(new Error('boom'))).toContain('No funds were moved');
    expect(describeSettlementError(new SecureSignerError('USER_CANCELLED', 'x'))).toContain('cancelled');
  });

  it('keeps the cause of an unmapped failure, because a phone has no console', () => {
    // Anything unanticipated reaches the screen as "could not be completed",
    // which is the right thing to read and useless to report. The detail line
    // is what turns the next attempt into evidence.
    const detail = settlementErrorDetail(Object.assign(new Error('simulation failed: HostError'), {code: 'X42'}));
    expect(detail).toContain('X42');
    expect(detail).toContain('simulation failed');

    expect(settlementErrorDetail('not an error')).toBeUndefined();
    expect(settlementErrorDetail(new Error('x'.repeat(400)))!.length).toBeLessThan(220);
  });
it('names a wallet the chain refused for want of funds, in the words the chain used', () => {
    // A Stellar Asset Contract says "balance is not sufficient to spend". It
    // contains no word "insufficient", so this is the exact refusal a customer
    // gets when paying a second time from a wallet already spent offline.
    expect(
      describeSettlementError(new Error('HostError: balance is not sufficient to spend'), 'XLM'),
    ).toContain('does not have enough XLM');
  });

  it('passes a counter refusal on as the refusal it was, not as a mystery', () => {
    // The merchant is the half that reached the chain, so its sentence is the
    // only account of what happened. It goes through the same mapping it would
    // have had this phone submitted the transaction itself.
    expect(
      describeSettlementError(
        new OfflineCustomerError('FAILED', 'Error(Contract, #10): balance is not sufficient to spend'),
        'USDC',
      ),
    ).toContain('does not have enough USDC');
  });

  it('says plainly when a counter cannot take an offline payment at all', () => {
    expect(
      describeSettlementError(new OfflineCustomerError('NOT_OFFERED', 'whatever the code said')),
    ).toContain('cannot take a payment from a phone with no connection');
  });
});
