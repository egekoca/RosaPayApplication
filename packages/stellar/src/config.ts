import {Networks} from '@stellar/stellar-sdk';
import {z} from 'zod';
import {testnetDeployment} from './deployments';

export const stellarNetworkSchema = z.enum(['testnet', 'pubnet', 'local']);
export type StellarNetwork = z.infer<typeof stellarNetworkSchema>;

export type StellarConfig = {
  network: StellarNetwork;
  networkPassphrase: string;
  rpcUrl: string;
  horizonUrl: string;
  friendbotUrl: string | null;
  settlementContractId: string | null;
};

const defaults: Record<StellarNetwork, Omit<StellarConfig, 'network' | 'settlementContractId'>> = {
  testnet: {
    networkPassphrase: Networks.TESTNET,
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    friendbotUrl: 'https://friendbot.stellar.org',
  },
  pubnet: {
    networkPassphrase: Networks.PUBLIC,
    rpcUrl: '',
    horizonUrl: 'https://horizon.stellar.org',
    friendbotUrl: null,
  },
  local: {
    networkPassphrase: 'Standalone Network ; February 2017',
    rpcUrl: 'http://127.0.0.1:8000/soroban/rpc',
    horizonUrl: 'http://127.0.0.1:8000',
    friendbotUrl: 'http://127.0.0.1:8000/friendbot',
  },
};

export function createStellarConfig(
  networkInput: string = 'testnet',
  overrides: Partial<Pick<StellarConfig, 'rpcUrl' | 'horizonUrl' | 'settlementContractId'>> = {},
): StellarConfig {
  const network = stellarNetworkSchema.parse(networkInput);
  const definedOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined),
  ) as typeof overrides;
  const config = {...defaults[network], ...definedOverrides};
  if (!config.rpcUrl) {
    throw new Error('A provider-specific RPC URL is required for pubnet');
  }
  const defaultContractId = network === 'testnet' ? testnetDeployment.settlementContractId : null;
  return {
    network,
    ...config,
    settlementContractId: overrides.settlementContractId === undefined
      ? defaultContractId
      : overrides.settlementContractId,
  };
}
