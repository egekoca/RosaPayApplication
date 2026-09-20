import {shouldShowRequest} from '../src/features/merchant/MerchantRequestScreen';

const live = {
  published: true,
  settlementStatus: 'awaiting_approval' as string | undefined,
  ledgerUnavailable: false,
  latestLedger: 1_500_000,
  expiresAtLedger: 1_500_060,
};

describe('whether a request is on the counter', () => {
  it('shows a published request the API has confirmed is waiting', () => {
    expect(shouldShowRequest(live)).toBe(true);
  });

  /*
   * The bug this holds shut. The status arrives on a poll, a whole round trip
   * after publishing and longer on a host that sleeps between demos, and a
   * failed poll pushed it to the one after that. Demanding it meant a merchant
   * watched a request card with no code on it while a customer waited.
   */
  it('shows one whose status has not come back yet', () => {
    expect(shouldShowRequest({...live, settlementStatus: undefined})).toBe(true);
  });

  it('stops offering one a customer has already claimed', () => {
    // A request leaves `awaiting_approval` the moment it is taken, and handing
    // the same one to a second customer is what this prevents.
    expect(shouldShowRequest({...live, settlementStatus: 'authorized'})).toBe(false);
    expect(shouldShowRequest({...live, settlementStatus: 'confirmed'})).toBe(false);
    expect(shouldShowRequest({...live, settlementStatus: 'rejected'})).toBe(false);
  });

  it('shows nothing before the API has the request', () => {
    expect(shouldShowRequest({...live, published: false})).toBe(false);
  });

  it('shows nothing without a ledger to check the expiry against', () => {
    // A code left up while Testnet is unreachable invites a customer to pay a
    // request whose five-minute window this phone can no longer verify.
    expect(shouldShowRequest({...live, latestLedger: undefined})).toBe(false);
    expect(shouldShowRequest({...live, ledgerUnavailable: true})).toBe(false);
  });

  it('takes it down the moment it expires', () => {
    expect(shouldShowRequest({...live, expiresAtLedger: 1_500_000})).toBe(false);
    expect(shouldShowRequest({...live, expiresAtLedger: 1_499_999})).toBe(false);
    expect(shouldShowRequest({...live, expiresAtLedger: 1_500_001})).toBe(true);
  });
});
