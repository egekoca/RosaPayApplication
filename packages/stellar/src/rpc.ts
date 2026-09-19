import {rpc} from '@stellar/stellar-sdk';
import type {StellarConfig} from './config';

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
}
