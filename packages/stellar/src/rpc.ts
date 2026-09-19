import {rpc} from '@stellar/stellar-sdk';
import type {StellarConfig} from './config';
import {createSettlementContractSpec} from './settlementClient';

export type StellarHealth = {
  status: string;
  latestLedger: number;
  oldestLedger: number;
  protocolVersion: number;
};

export type ConfirmedStellarTransaction = {
  txHash: string;
  ledger: number;
};

export class StellarTransactionError extends Error {
  override readonly name = 'StellarTransactionError';

  constructor(
    readonly code: 'INVALID_HASH' | 'NOT_FOUND' | 'FAILED' | 'INVALID_SUCCESS_RESPONSE',
    message: string,
  ) {
    super(message);
  }
}

export type SettlementEvent = {
  eventId: string;
  transactionHash: string;
  ledger: number;
  intentId: string;
  merchantId: string;
  customer: string;
  recipient: string;
  token: string;
  amount: string;
};

export type SettlementEventPage = {
  events: SettlementEvent[];
  cursor: string;
  latestLedger: number;
  oldestLedger: number;
};

export class StellarEventQueryError extends Error {
  override readonly name = 'StellarEventQueryError';

  constructor(
    readonly code: 'INVALID_LEDGER_RANGE' | 'CONTRACT_UNAVAILABLE',
    message: string,
  ) {
    super(message);
  }
}

export class StellarRpcClient {
  readonly server: rpc.Server;

  constructor(readonly config: StellarConfig) {
    this.server = new rpc.Server(config.rpcUrl);
  }

  async health(): Promise<StellarHealth> {
    const [health, ledger] = await Promise.all([
      this.server.getHealth(),
      this.server.getLatestLedger(),
    ]);
    return {
      status: health.status,
      latestLedger: ledger.sequence,
      oldestLedger: health.oldestLedger,
      protocolVersion: Number.parseInt(ledger.protocolVersion, 10),
    };
  }

  async waitForTransaction(hash: string) {
    return this.server.pollTransaction(hash, {
      attempts: 12,
      sleepStrategy: attempt => Math.min(500 * 2 ** attempt, 5_000),
    });
  }

  async confirmTransaction(hash: string): Promise<ConfirmedStellarTransaction> {
    if (!/^[a-f0-9]{64}$/i.test(hash)) {
      throw new StellarTransactionError('INVALID_HASH', 'Transaction hash must be a 64-character hexadecimal value');
    }

    const response = await this.waitForTransaction(hash);
    if (response.status === 'NOT_FOUND') {
      throw new StellarTransactionError('NOT_FOUND', `Transaction ${hash} was not found before polling ended`);
    }
    if (response.status === 'FAILED') {
      throw new StellarTransactionError('FAILED', `Transaction ${hash} failed on Stellar`);
    }
    if (response.status !== 'SUCCESS' || !Number.isSafeInteger(response.ledger) || response.ledger <= 0) {
      throw new StellarTransactionError('INVALID_SUCCESS_RESPONSE', `Transaction ${hash} did not return a valid success receipt`);
    }
    return {txHash: response.txHash, ledger: response.ledger};
  }

  async getSettlementEvents(input: {
    startLedger?: number;
    endLedger?: number;
    cursor?: string;
    limit?: number;
  }): Promise<SettlementEventPage> {
    const contractId = this.config.settlementContractId;
    if (!contractId) {
      throw new StellarEventQueryError('CONTRACT_UNAVAILABLE', 'A settlement contract ID is required to query events');
    }
    if (input.cursor === undefined && (!Number.isSafeInteger(input.startLedger) || input.startLedger! <= 0)) {
      throw new StellarEventQueryError('INVALID_LEDGER_RANGE', 'Event start ledger must be a positive integer');
    }
    if (input.cursor !== undefined && (input.endLedger !== undefined || input.startLedger !== undefined)) {
      throw new StellarEventQueryError('INVALID_LEDGER_RANGE', 'Event cursor cannot be combined with a ledger range');
    }
    if (input.endLedger !== undefined && (!Number.isSafeInteger(input.endLedger) || input.endLedger < input.startLedger!)) {
      throw new StellarEventQueryError('INVALID_LEDGER_RANGE', 'Event end ledger must be greater than or equal to the start ledger');
    }
    if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit <= 0)) {
      throw new StellarEventQueryError('INVALID_LEDGER_RANGE', 'Event limit must be a positive integer');
    }
    if (input.cursor !== undefined && input.cursor.trim().length === 0) {
      throw new StellarEventQueryError('INVALID_LEDGER_RANGE', 'Event cursor must not be empty');
    }

    const spec = createSettlementContractSpec(this.config);
    const filters = [{
      type: 'contract' as const,
      contractIds: [contractId],
      topics: [spec.eventTopicFilter('PaymentSettled')],
    }];
    const request = input.cursor === undefined
      ? {
          filters,
          startLedger: input.startLedger!,
          ...(input.endLedger === undefined ? {} : {endLedger: input.endLedger}),
          ...(input.limit === undefined ? {} : {limit: input.limit}),
        }
      : {
          filters,
          cursor: input.cursor,
          ...(input.limit === undefined ? {} : {limit: input.limit}),
        };
    const response = await this.server.getEvents(request);
    const events = response.events.flatMap(event => {
      if (!event.inSuccessfulContractCall) return [];
      if (event.contractId && event.contractId.toString() !== contractId) return [];
      const parsed = spec.parseEvent(event.topic, event.value);
      if (!parsed || parsed.name !== 'PaymentSettled') return [];
      try {
        const data = parsed.data as Record<string, unknown>;
        return [{
          eventId: event.id,
          transactionHash: event.txHash,
          ledger: event.ledger,
          intentId: bytesToHex(data.intent_id, 'intent_id'),
          merchantId: bytesToHex(data.merchant_id, 'merchant_id'),
          customer: addressToString(data.customer, 'customer'),
          recipient: addressToString(data.recipient, 'recipient'),
          token: addressToString(data.token, 'token'),
          amount: amountToString(data.amount),
        } satisfies SettlementEvent];
      } catch {
        return [];
      }
    });

    return {
      events,
      cursor: response.cursor,
      latestLedger: response.latestLedger,
      oldestLedger: response.oldestLedger,
    };
  }
}

function bytesToHex(value: unknown, field: string): string {
  if (!(value instanceof Uint8Array) || value.byteLength !== 32) {
    throw new Error(`Invalid ${field} event value`);
  }
  return Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
}

function addressToString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${field} event value`);
  }
  return value;
}

function amountToString(value: unknown): string {
  if ((typeof value !== 'bigint' && typeof value !== 'number' && typeof value !== 'string') || String(value).length === 0) {
    throw new Error('Invalid amount event value');
  }
  return String(value);
}
