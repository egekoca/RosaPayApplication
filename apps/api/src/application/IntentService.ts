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

export type SettlementRecord = {
  intentId: string;
  status: PaymentStatus;
  transactionHash?: string;
  ledger?: number;
  failureCode?: string;
  confirmedAt?: string;
};

export interface IntentRepository {
  findByIntentId(intentId: string): Promise<StoredIntent | null>;
  findByIdempotencyKey(key: string): Promise<StoredIntent | null>;
  save(intent: StoredIntent): Promise<void>;
  saveIntentWithSettlement?(intent: StoredIntent, settlement: SettlementRecord): Promise<void>;
  findSettlement(intentId: string): Promise<SettlementRecord | null>;
  saveAuthorization?(authorization: AuthorizationRecord): Promise<void>;
  findAuthorization?(intentId: string): Promise<AuthorizationRecord | null>;
  listSettlements(status?: PaymentStatus): Promise<SettlementRecord[]>;
  saveSettlement(settlement: SettlementRecord): Promise<void>;
}

export class IntentConflictError extends Error {}
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

  async listSubmittedSettlements(): Promise<SettlementRecord[]> {
    return this.repository.listSettlements('submitted');
  }

  /**
   * Records who authorized the payment before moving the settlement forward, so
   * a submitted transaction can always be traced back to an authorization.
   */
  async authorize(intentId: string, authorization?: Omit<AuthorizationRecord, 'intentId' | 'receivedAt'>) {
    if (authorization) {
      if (!/^[GC][A-Z2-7]{55}$/.test(authorization.authorizer)) {
        throw new SettlementInputError('The authorizer must be a Stellar address');
      }
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
    await this.repository.saveSettlement(updated);
    return updated;
  }
}

function assertTransactionHash(value: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new SettlementInputError('Transaction hash must be a 64-character hexadecimal value');
  }
}
