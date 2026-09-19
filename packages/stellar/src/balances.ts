import {Account, Address, Asset, Contract, TransactionBuilder, rpc, scValToNative} from '@stellar/stellar-sdk';
import type {StellarConfig} from './config';

/** Any account that can hold the native asset, classic or contract. */
export type BalanceHolder = string;

export class BalanceQueryError extends Error {
  override readonly name = 'BalanceQueryError';
}

/**
 * Reads a native XLM balance through the asset contract, which works for both
 * classic accounts and contract accounts. Horizon does not index balances held
 * by a contract, so a smart wallet can only be read this way.
 */
export async function readNativeBalance(
  config: StellarConfig,
  holder: BalanceHolder,
  server: rpc.Server = new rpc.Server(config.rpcUrl),
): Promise<string> {
  const nativeContract = new Contract(Asset.native().contractId(config.networkPassphrase));
  // Simulation needs a source account; a read never touches it.
  const source = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0');
  const transaction = new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(nativeContract.call('balance', Address.fromString(holder).toScVal()))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
    throw new BalanceQueryError(`The balance of ${holder} could not be read`);
  }

  const stroops = scValToNative(simulation.result.retval) as bigint | number;
  return formatStroops(BigInt(stroops));
}

/** Stroops are integers; the display value keeps all seven decimal places. */
export function formatStroops(stroops: bigint): string {
  const negative = stroops < 0n;
  const absolute = negative ? -stroops : stroops;
  const whole = absolute / 10_000_000n;
  const fraction = (absolute % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}
