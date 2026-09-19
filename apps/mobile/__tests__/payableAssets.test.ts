import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Asset} from '@stellar/stellar-sdk';
import {defaultPayableAsset, payableAssetByCode, payableAssets} from '../src/features/payments/assets';

// Read from disk rather than imported, so this test fails when the deployment
// changes without anyone having to remember to re-export it.
const deployment = JSON.parse(
  readFileSync(join(__dirname, '../../../config/testnet-deployment.json'), 'utf8'),
) as {
  networkPassphrase: string;
  nativeAssetContractId: string;
  registeredAssets?: Array<{code: string; contractId: string}>;
};

/** The SAC each payable asset moves through, which is what the contract checks. */
function contractIdOf(code: string): string {
  const entry = payableAssetByCode(code)!;
  return entry.asset.type === 'native'
    ? Asset.native().contractId(deployment.networkPassphrase)
    : new Asset(entry.asset.code, entry.asset.issuer!).contractId(deployment.networkPassphrase);
}

describe('what a merchant may ask to be paid in', () => {
  it('offers nothing the settlement contract has not been told about', () => {
    // The contract refuses an unregistered token, so an asset offered here but
    // missing on chain fails at the counter with the customer already
    // committed. `npm run testnet:register-asset -- --list` asks the contract.
    const registered = new Set([
      deployment.nativeAssetContractId,
      ...(deployment.registeredAssets ?? []).map(asset => asset.contractId),
    ]);

    for (const entry of payableAssets) {
      expect(registered).toContain(contractIdOf(entry.code));
    }
  });

  it('sends lumens unless a merchant says otherwise', () => {
    expect(defaultPayableAsset.code).toBe('XLM');
    expect(defaultPayableAsset.asset).toEqual({type: 'native', code: 'XLM', decimals: 7});
  });

  it('names USDC by the issuer our own price anchor lists', () => {
    // The currency a merchant prices in and the asset the customer sends have
    // to come from the same anchor, or the rate quotes one thing and the
    // payment moves another.
    const usdc = payableAssetByCode('USDC');
    expect(usdc?.asset).toMatchObject({
      type: 'credit',
      code: 'USDC',
      issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    });
    expect(usdc?.sep38).toBe('stellar:USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
  });

  it('gives every asset the SEP-38 name an anchor would price it under', () => {
    for (const entry of payableAssets) {
      const expected =
        entry.asset.type === 'native' ? 'stellar:native' : `stellar:${entry.asset.code}:${entry.asset.issuer}`;
      expect(entry.sep38).toBe(expected);
    }
  });
});
