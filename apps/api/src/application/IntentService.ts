import {transitionPayment, type Payment, type PaymentStatus} from '@rosapay/domain';
import {hashPaymentIntent, parseSignedPaymentIntent, type SignedPaymentIntentV1} from '@rosapay/protocol';

export type StoredIntent = {
  payload: SignedPaymentIntentV1;
  payloadHash: string;
  idempotencyKey: string;
  status: 'created';
};

/**
 * What the customer authorized, kept for audit. It never holds key material:
 * only the authorizing address, a hash of the authorization and its expiry.
 */
export type AuthorizationRecord = {
  intentId: string;
  authorizer: string;
  authorizationHash?: string;
  expiresAtLedger?: number;
  receivedAt: string;
};

/**
 * A merchant's promise that one specific customer may pay one specific request.
 *
 * The settlement contract verifies a merchant signature over a digest that names
 * the payer, so it can only be produced once the payer is known — which is after
 * the customer has seen the request. The merchant's signing key stays on the
 * merchant's own device; this record is the meeting point where a customer says
 * "this is me" and collects the answer.
 */
export type CountersignatureRecord = {
  intentId: string;
  /** The Stellar address that will pay, classic or contract. */
  customerAddress: string;
  /** Base64 Ed25519 signature over the contract digest; absent until signed. */
  signature?: string;
  requestedAt: string;
  signedAt?: string;
};

export type SettlementRecord = {
  intentId: string;
  status: PaymentStatus;
  transactionHash?: string;
  ledger?: number;
  failureCode?: string;
  confirmedAt?: string;
};

export type MerchantPayment = {
  intentId: string;
  amount: string;
  assetCode: string;
  reference: string;
  createdAt: string;
  status: PaymentStatus;
  transactionHash?: string;
  ledger?: number;
  confirmedAt?: string;
};

/**
 * What the service has handled, for an operator rather than for a customer. It
 * counts requests by outcome and reports how long a confirmed payment took,
 * measured between two moments the server observed itself.
 */
export type PaymentMetrics = {
  intents: number;
  byStatus: Record<PaymentStatus, number>;
  /**
   * The middle confirmation time in seconds, or null when nothing has confirmed
   * yet. Median rather than mean: one payment that sat behind a stuck ledger
   * would drag an average away from the experience everyone else had.
   */
  medianConfirmationSeconds: number | null;
};

export const paymentStatuses: PaymentStatus[] = [
  'awaiting_approval',
  'authorized',
  'submitted',
  'confirmed',
  'rejected',
  'expired',
  'failed',
];

export function emptyPaymentMetrics(): PaymentMetrics {
  return {
    intents: 0,
    byStatus: Object.fromEntries(paymentStatuses.map(status => [status, 0])) as Record<PaymentStatus, number>,
    medianConfirmationSeconds: null,
  };
}

export interface IntentRepository {
  readMetrics?(): Promise<PaymentMetrics>;
  saveCountersignature?(record: CountersignatureRecord): Promise<void>;
  findCountersignature?(intentId: string): Promise<CountersignatureRecord | null>;
  findByIntentId(intentId: string): Promise<StoredIntent | null>;
  findByIdempotencyKey(key: string): Promise<StoredIntent | null>;
  save(intent: StoredIntent): Promise<void>;
  saveIntentWithSettlement?(intent: StoredIntent, settlement: SettlementRecord): Promise<void>;
  findSettlement(intentId: string): Promise<SettlementRecord | null>;
  saveAuthorization?(authorization: AuthorizationRecord): Promise<void>;
  findAuthorization?(intentId: string): Promise<AuthorizationRecord | null>;
  listSettlements(status?: PaymentStatus): Promise<SettlementRecord[]>;
  listMerchantPayments?(merchantProfileId: string, limit: number): Promise<MerchantPayment[]>;
  saveSettlement(settlement: SettlementRecord): Promise<void>;
  compareAndSetSettlement(
    intentId: string,
    expectedStatus: PaymentStatus,
    settlement: SettlementRecord,
  ): Promise<boolean>;
}

export class IntentConflictError extends Error {}
export class CountersignatureConflictError extends Error {}
export class CountersignatureNotFoundError extends Error {}
export class SettlementNotFoundError extends Error {}
export class SettlementInputError extends Error {}
export class SettlementTransitionError extends Error {}

export class IntentService {
  constructor(private readonly repository: IntentRepository) {}

  async create(input: unknown, idempotencyKey: string): Promise<StoredIntent> {
    const payload = parseSignedPaymentIntent(input);
    const payloadHash = hashPaymentIntent(payload.intent);
    const previous = await this.repository.findByIdempotencyKey(idempotencyKey);
    if (previous) {
      if (previous.payloadHash !== payloadHash) {
        throw new IntentConflictError('Idempotency key already used for a different intent');
      }
      return previous;
    }

    if (await this.repository.findByIntentId(payload.intent.intentId)) {
      throw new IntentConflictError('Intent ID already exists');
    }

    const stored: StoredIntent = {
      payload,
      payloadHash,
      idempotencyKey,
      status: 'created',
    };
    const initialSettlement: SettlementRecord = {intentId: payload.intent.intentId, status: 'awaiting_approval'};
    if (this.repository.saveIntentWithSettlement) {
      await this.repository.saveIntentWithSettlement(stored, initialSettlement);
    } else {
      await this.repository.save(stored);
      await this.repository.saveSettlement(initialSettlement);
    }
    return stored;
  }

  get(intentId: string) {
    return this.repository.findByIntentId(intentId);
  }

  async getSettlement(intentId: string): Promise<SettlementRecord | null> {
    if (!(await this.repository.findByIntentId(intentId))) return null;
    return this.repository.findSettlement(intentId);
  }

  /** What this service has handled, for an operator watching it run. */
  readMetrics(): Promise<PaymentMetrics> {
    return this.repository.readMetrics?.() ?? Promise.resolve(emptyPaymentMetrics());
  }

  /** What a merchant has been asked to be paid, and what happened to each request. */
  listMerchantPayments(merchantProfileId: string, limit = 25): Promise<MerchantPayment[]> {
    return this.repository.listMerchantPayments?.(merchantProfileId, limit) ?? Promise.resolve([]);
  }

  async listSubmittedSettlements(): Promise<SettlementRecord[]> {
    return this.repository.listSettlements('submitted');
  }

  /**
   * Records who authorized the payment before moving the settlement forward, so
   * a submitted transaction can always be traced back to an authorization.
   */
  async authorize(intentId: string, authorization?: Omit<AuthorizationRecord, 'intentId' | 'receivedAt'>) {
    if (authorization) {
      assertStellarAddress(authorization.authorizer, 'The authorizer must be a Stellar address');
      if (authorization.authorizationHash && !/^[a-f0-9]{64}$/i.test(authorization.authorizationHash)) {
        throw new SettlementInputError('The authorization hash must be a 64-character hexadecimal value');
      }
      if (
        authorization.expiresAtLedger !== undefined &&
        (!Number.isSafeInteger(authorization.expiresAtLedger) || authorization.expiresAtLedger <= 0)
      ) {
        throw new SettlementInputError('The authorization expiry must be a positive ledger');
      }
      await this.repository.saveAuthorization?.({
        intentId,
        ...authorization,
        receivedAt: new Date().toISOString(),
      });
    }
    return this.transitionSettlement(intentId, 'authorized');
  }

  /**
   * Records which customer intends to pay, so the merchant knows who to
   * countersign for.
   *
   * The first customer to claim a request keeps it. Without that, two customers
   * scanning the same code would race, and the merchant would countersign for
   * whichever claim landed last while the other waited for a signature naming
   * someone else — which the contract would reject anyway, after the customer
   * had already been told to approve.
   */
  async requestCountersignature(intentId: string, customerAddress: string): Promise<CountersignatureRecord> {
    if (!(await this.repository.findByIntentId(intentId))) {
      throw new SettlementNotFoundError('Payment intent not found');
    }
    assertStellarAddress(customerAddress);

    const existing = await this.repository.findCountersignature?.(intentId);
    if (existing) {
      if (existing.customerAddress !== customerAddress) {
        throw new CountersignatureConflictError('Another customer is already paying this request');
      }
      return existing;
    }

    const record: CountersignatureRecord = {
      intentId,
      customerAddress,
      requestedAt: new Date().toISOString(),
    };
    await this.repository.saveCountersignature?.(record);
    return record;
  }

  /**
   * Stores the merchant's signature for the customer that asked.
   *
   * The address is checked rather than trusted: a signature that names a
   * different payer than the one waiting would be collected by that waiting
   * customer and fail on-chain, so it is refused here instead.
   */
  async supplyCountersignature(
    intentId: string,
    customerAddress: string,
    signature: string,
  ): Promise<CountersignatureRecord> {
    const existing = await this.repository.findCountersignature?.(intentId);
    if (!existing) {
      throw new CountersignatureNotFoundError('No customer has asked to pay this request');
    }
    if (existing.customerAddress !== customerAddress) {
      throw new CountersignatureConflictError('This signature names a different customer');
    }
    if (!/^[A-Za-z0-9+/]{86}==$/.test(signature)) {
      throw new SettlementInputError('A countersignature must be a base64 64-byte signature');
    }
    if (existing.signature) return existing;

    const record: CountersignatureRecord = {
      ...existing,
      signature,
      signedAt: new Date().toISOString(),
    };
    await this.repository.saveCountersignature?.(record);
    return record;
  }

  getCountersignature(intentId: string): Promise<CountersignatureRecord | null> {
    return this.repository.findCountersignature?.(intentId) ?? Promise.resolve(null);
  }

  getAuthorization(intentId: string): Promise<AuthorizationRecord | null> {
    return this.repository.findAuthorization?.(intentId) ?? Promise.resolve(null);
  }

  async submit(intentId: string, transactionHash: string) {
    assertTransactionHash(transactionHash);
    return this.transitionSettlement(intentId, 'submitted', {transactionHash});
  }

  async confirm(intentId: string, transactionHash: string, ledger: number) {
    assertTransactionHash(transactionHash);
    if (!Number.isSafeInteger(ledger) || ledger <= 0) {
      throw new SettlementInputError('A positive ledger sequence is required');
    }
    return this.transitionSettlement(intentId, 'confirmed', {
      transactionHash,
      ledger,
      confirmedAt: new Date().toISOString(),
    });
  }

  fail(intentId: string, failureCode: string) {
    const normalizedCode = failureCode.trim();
    if (!normalizedCode) throw new SettlementInputError('A failure code is required');
    return this.transitionSettlement(intentId, 'failed', {failureCode: normalizedCode});
  }

  private async transitionSettlement(
    intentId: string,
    next: PaymentStatus,
    patch: Partial<SettlementRecord> = {},
  ): Promise<SettlementRecord> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.repository.findSettlement(intentId);
      if (!current) throw new SettlementNotFoundError('Settlement not found');
      if (current.status === next) {
        if (patch.transactionHash && current.transactionHash && patch.transactionHash !== current.transactionHash) {
          throw new SettlementTransitionError('A settlement cannot change its transaction hash');
        }
        return current;
      }

      const payment: Payment = {
        intentId,
        status: current.status,
        transactionHash: current.transactionHash,
        failureCode: current.failureCode,
      };
      try {
        transitionPayment(payment, next);
      } catch (error) {
        throw new SettlementTransitionError(error instanceof Error ? error.message : 'Invalid settlement transition');
      }

      const updated: SettlementRecord = {...current, status: next, ...patch};
      if (await this.repository.compareAndSetSettlement(intentId, current.status, updated)) return updated;
    }
    throw new SettlementTransitionError('The settlement changed concurrently; retry with the latest status');
  }
}

function assertStellarAddress(value: string, message = 'A Stellar address is required'): void {
  if (!/^[GC][A-Z2-7]{55}$/.test(value)) {
    throw new SettlementInputError(message);
  }
}

function assertTransactionHash(value: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new SettlementInputError('Transaction hash must be a 64-character hexadecimal value');
  }
}
