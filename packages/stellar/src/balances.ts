import {Account, Address, Asset, Contract, TransactionBuilder, rpc, scValToNative} from '@stellar/stellar-sdk';
import type {StellarConfig} from './config';

/** Any account that can hold the native asset, classic or contract. */
export type BalanceHolder = string;

export class BalanceQueryError extends Error {
  override readonly name = 'BalanceQueryError';
}

/**
 * Reads what a holder has of one asset, through that asset's contract.
 *
 * Asking the token itself works for both classic accounts and contract
 * accounts. Horizon does not index balances held by a contract, so a smart
 * wallet can only be read this way — and the same call answers for USDC as for
 * lumens, because a Stellar Asset Contract presents every asset alike.
 */
export async function readAssetBalance(
  config: StellarConfig,
  holder: BalanceHolder,
  assetContractId: string,
  server: rpc.Server = new rpc.Server(config.rpcUrl),
): Promise<string> {
  const contract = new Contract(assetContractId);
  // Simulation needs a source account; a read never touches it.
  const source = new Account('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', '0');
  const transaction = new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(contract.call('balance', Address.fromString(holder).toScVal()))
    .setTimeout(30)
    .build();

  const simulation = await server.simulateTransaction(transaction);
  if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) {
    throw new BalanceQueryError(`The balance of ${holder} could not be read`);
  }

  const stroops = scValToNative(simulation.result.retval) as bigint | number;
  return formatStroops(BigInt(stroops));
}

/** What a holder has in lumens. */
export function readNativeBalance(
  config: StellarConfig,
  holder: BalanceHolder,
  server: rpc.Server = new rpc.Server(config.rpcUrl),
): Promise<string> {
  return readAssetBalance(config, holder, Asset.native().contractId(config.networkPassphrase), server);
}

/** Stroops are integers; the display value keeps all seven decimal places. */
export function formatStroops(stroops: bigint): string {
  const negative = stroops < 0n;
  const absolute = negative ? -stroops : stroops;
  const whole = absolute / 10_000_000n;
  const fraction = (absolute % 10_000_000n).toString().padStart(7, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/**
 * Whether a holder could receive this asset at all.
 *
 * A classic account needs a trustline before it can hold a credit asset, and
 * without one the token refuses even to report a balance. A contract account
 * needs nothing: a Stellar Asset Contract keeps its balance in contract
 * storage. So the question "can this address be paid in USDC?" is answered by
 * asking the token, which is the same thing the settlement will do.
 *
 * A network failure reads as "cannot", which is the safe way round: refusing to
 * offer an asset costs a merchant a choice, and offering one that cannot arrive
 * costs them a sale with the customer already committed.
 */
export async function canReceiveAsset(
  config: StellarConfig,
  holder: BalanceHolder,
  assetContractId: string,
  server: rpc.Server = new rpc.Server(config.rpcUrl),
): Promise<boolean> {
  return readAssetBalance(config, holder, assetContractId, server).then(
    () => true,
    () => false,
  );
}
