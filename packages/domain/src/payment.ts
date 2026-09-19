export type PaymentStatus =
  | 'created'
  | 'awaiting_approval'
  | 'authorized'
  | 'submitted'
  | 'confirmed'
  | 'rejected'
  | 'expired'
  | 'failed';

const allowedTransitions: Record<PaymentStatus, readonly PaymentStatus[]> = {
  created: ['awaiting_approval', 'expired', 'failed'],
  awaiting_approval: ['authorized', 'rejected', 'expired', 'failed'],
  authorized: ['submitted', 'failed'],
  submitted: ['confirmed', 'failed'],
  confirmed: [],
  rejected: [],
  expired: [],
  failed: [],
};

export type Payment = {
  intentId: string;
  status: PaymentStatus;
  transactionHash?: string;
  failureCode?: string;
};

export class InvalidPaymentTransitionError extends Error {}

export function transitionPayment(payment: Payment, next: PaymentStatus): Payment {
  if (!allowedTransitions[payment.status].includes(next)) {
    throw new InvalidPaymentTransitionError(`Cannot transition ${payment.status} to ${next}`);
  }
  return {...payment, status: next};
}

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return allowedTransitions[status].length === 0;
}
