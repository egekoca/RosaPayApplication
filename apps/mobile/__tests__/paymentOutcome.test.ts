import {isOfferable, paymentOutcome} from '../src/features/merchant/paymentOutcome';
import {outcomeLabel} from '../src/features/merchant/PaymentDetailSheet';

describe('what a merchant needs to know about one request', () => {
  it('answers the three questions a row in a list can hold', () => {
    // Eight settlement states is more than a row can say. A merchant is asking
    // whether money arrived, whether it still might, or whether it is over.
    expect(paymentOutcome('confirmed')).toBe('paid');

    for (const live of ['created', 'awaiting_approval', 'authorized', 'submitted']) {
      expect(paymentOutcome(live)).toBe('open');
    }

    for (const over of ['expired', 'rejected', 'failed']) {
      expect(paymentOutcome(over)).toBe('closed');
    }
  });

  it('stops offering a request the moment a customer claims it', () => {
    // Narrower than "not closed" on purpose: an authorized request is already
    // on its way to the chain and must never be handed to a second customer.
    expect(isOfferable('awaiting_approval')).toBe(true);
    for (const taken of ['created', 'authorized', 'submitted', 'confirmed', 'expired', 'failed']) {
      expect(isOfferable(taken)).toBe(false);
    }
  });

  it('names an expired request as expired, because that one has a next move', () => {
    expect(outcomeLabel('expired')).toBe('EXPIRED');
    expect(outcomeLabel('confirmed')).toBe('PAID');
    expect(outcomeLabel('awaiting_approval')).toBe('WAITING');
    expect(outcomeLabel('rejected')).toBe('DECLINED');
    expect(outcomeLabel('failed')).toBe('FAILED');
    // Everything mid-flight reads the same, because to a merchant it is.
    expect(outcomeLabel('submitted')).toBe('IN PROGRESS');
    expect(outcomeLabel('authorized')).toBe('IN PROGRESS');
  });
});
