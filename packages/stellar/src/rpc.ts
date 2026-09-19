import {rpc} from '@stellar/stellar-sdk';
import type {StellarConfig} from './config';

export type StellarHealth = {
  status: string;
  latestLedger: number;
  oldestLedger: number;
  protocolVersion: number;
};

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
}
