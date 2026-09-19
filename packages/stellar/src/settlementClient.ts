import type {ClientOptions} from '@stellar/stellar-sdk/contract';

import {Client as GeneratedSettlementClient} from './generated/settlement';
import type {StellarConfig} from './config';

export type SettlementClientSignerOptions = Pick<
  ClientOptions,
  'publicKey' | 'signAuthEntry' | 'signTransaction'
>;

export function createSettlementClient(
  config: StellarConfig,
  signer: SettlementClientSignerOptions = {},
): GeneratedSettlementClient {
  if (!config.settlementContractId) {
    throw new Error('A deployed settlement contract ID is required');
  }
  return new GeneratedSettlementClient({
    contractId: config.settlementContractId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    ...signer,
  });
}

export {
  Client as SettlementContractClient,
  Errors as SettlementContractErrors,
  type Merchant as SettlementMerchant,
  type PaymentIntent as SettlementContractPaymentIntent,
} from './generated/settlement';
