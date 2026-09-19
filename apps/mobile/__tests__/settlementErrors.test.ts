import {SecureSignerError} from '@rosapay/secure-signer';
import {SettlementPipelineError, SettlementServiceError} from '@rosapay/stellar';
import {describeSettlementError} from '../src/features/payments/settlementErrors';
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
    expect(describeSettlementError(new TestnetSettlementError('MERCHANT_KEY_UNAVAILABLE', 'x'))).toContain('another device');
    expect(describeSettlementError(new SettlementServiceError('INVALID_MERCHANT_SIGNATURE', 'x'))).toContain('does not match');
  });

  it('never claims a partial success for an unknown failure', () => {
    expect(describeSettlementError(new Error('boom'))).toContain('No funds were moved');
    expect(describeSettlementError(new SecureSignerError('USER_CANCELLED', 'x'))).toContain('cancelled');
  });
});
