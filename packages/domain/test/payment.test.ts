import {describe, expect, it} from 'vitest';
import {transitionPayment, type Payment} from '../src';

describe('payment state machine', () => {
  const payment: Payment = {intentId: 'intent-1', status: 'created'};

  it('follows the approval and settlement path', () => {
    const awaiting = transitionPayment(payment, 'awaiting_approval');
    const authorized = transitionPayment(awaiting, 'authorized');
    const submitted = transitionPayment(authorized, 'submitted');
    expect(transitionPayment(submitted, 'confirmed').status).toBe('confirmed');
  });

  it('does not permit false success', () => {
    expect(() => transitionPayment(payment, 'confirmed')).toThrow('Cannot transition');
  });

  it('expires an authorization that missed the submission deadline', () => {
    const authorized = transitionPayment(
      transitionPayment(payment, 'awaiting_approval'),
      'authorized',
    );

    expect(transitionPayment(authorized, 'expired').status).toBe('expired');
  });
});
