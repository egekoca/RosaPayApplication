import {AccountSetupError, fundOnTestnet} from '../src/features/wallet/accountSetup';
import type {StellarConfig} from '@rosapay/stellar';

const ADDRESS = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';

const testnet = {
  network: 'testnet',
  networkPassphrase: 'Test SDF Network ; September 2015',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  horizonUrl: 'https://horizon-testnet.stellar.org',
  friendbotUrl: 'https://friendbot.stellar.org',
} as unknown as StellarConfig;

const ok = () => Promise.resolve({ok: true, status: 200} as Response);
const refused = () => Promise.resolve({ok: false, status: 400} as Response);

describe('giving a new account its first balance', () => {
  it('asks the faucet for the address that was derived', async () => {
    const fetcher = jest.fn(ok);
    await fundOnTestnet(ADDRESS, testnet, fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith(`https://friendbot.stellar.org?addr=${ADDRESS}`);
  });

  it('reports an unreachable faucet rather than a wallet that looks ready', async () => {
    const fetcher = jest.fn(() => Promise.reject(new Error('offline')));
    await expect(
      fundOnTestnet(ADDRESS, testnet, fetcher as unknown as typeof fetch),
    ).rejects.toMatchObject({code: 'FUNDING_UNAVAILABLE'});
  });

  it('refuses to invent a faucet on a network that has none', async () => {
    const pubnet = {...testnet, friendbotUrl: null} as StellarConfig;
    await expect(fundOnTestnet(ADDRESS, pubnet)).rejects.toBeInstanceOf(AccountSetupError);
  });

  it('treats an already-funded account as done, because it is', async () => {
    // Friendbot answers 400 for an account it has funded before. Restoring a
    // phrase onto a second phone hits exactly that, and it is not a failure —
    // the account exists and can pay.
    const fetcher = jest.fn(refused);
    const existing = {...testnet} as StellarConfig;
    jest
      .spyOn(require('@stellar/stellar-sdk').rpc, 'Server')
      .mockImplementation(() => ({getAccount: async () => ({})}) as never);

    await expect(
      fundOnTestnet(ADDRESS, existing, fetcher as unknown as typeof fetch),
    ).resolves.toBeUndefined();
    jest.restoreAllMocks();
  });
});
