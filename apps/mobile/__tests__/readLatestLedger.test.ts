const mockHealth = jest.fn();

jest.mock('@rosapay/stellar', () => ({
  createStellarConfig: () => ({network: 'testnet'}),
  StellarRpcClient: class {
    health() {
      return mockHealth();
    }
  },
}));

import {readLatestLedger} from '../src/shared/useStellarHealth';

describe('reading the ledger a payment request is measured against', () => {
  beforeEach(() => mockHealth.mockReset());

  it('reports no ledger rather than a broken one, so an arrival fails closed', async () => {
    // Expiry is the whole reason this read exists. An unreachable node, or one
    // answering with something that is not a ledger, must never become a number
    // a signed request is checked against.
    mockHealth.mockRejectedValueOnce(new Error('offline'));
    await expect(readLatestLedger()).resolves.toBeUndefined();

    mockHealth.mockResolvedValueOnce({latestLedger: 0});
    await expect(readLatestLedger()).resolves.toBeUndefined();

    mockHealth.mockResolvedValueOnce({latestLedger: 'soon'});
    await expect(readLatestLedger()).resolves.toBeUndefined();
  });

  it('reads the live ledger on demand, with no polling behind it', async () => {
    mockHealth.mockResolvedValueOnce({latestLedger: 1_500_001});
    await expect(readLatestLedger()).resolves.toBe(1_500_001);
    expect(mockHealth).toHaveBeenCalledTimes(1);
  });
});
