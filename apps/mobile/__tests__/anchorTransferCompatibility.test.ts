import {Networks} from '@stellar/stellar-sdk';
import type {AnchorInfo} from '@rosapay/anchor';

import {
  AnchorTransferError,
  assertTestnetAnchorCompatibility,
  TESTNET_ANCHOR_HOME_DOMAIN,
} from '../src/features/wallet/anchorTransfer';

function anchor(overrides: Partial<AnchorInfo> = {}): AnchorInfo {
  return {
    homeDomain: TESTNET_ANCHOR_HOME_DOMAIN,
    networkPassphrase: Networks.TESTNET,
    signingKey: 'G'.padEnd(56, 'A'),
    webAuthEndpoint: 'https://testanchor.stellar.org/auth',
    webAuthForContractsEndpoint: 'https://testanchor.stellar.org/auth_contract',
    webAuthContractId: 'C'.padEnd(56, 'A'),
    transferServerSep24: 'https://testanchor.stellar.org/sep24',
    currencies: [{code: 'native'}],
    ...overrides,
  };
}

describe('the configured Testnet anchor boundary', () => {
  it('requires SEP-45, SEP-24 and the selected asset for the production wallet', () => {
    expect(() => assertTestnetAnchorCompatibility(anchor(), 'native')).not.toThrow();
    expect(() => assertTestnetAnchorCompatibility(
      anchor({webAuthForContractsEndpoint: undefined}),
      'native',
    )).toThrow(AnchorTransferError);
    expect(() => assertTestnetAnchorCompatibility(
      anchor({transferServerSep24: undefined}),
      'native',
    )).toThrow(AnchorTransferError);
    expect(() => assertTestnetAnchorCompatibility(anchor({currencies: []}), 'native')).toThrow(/native/);
  });

  it('keeps SEP-10 validation scoped to the experimental classic adapter', () => {
    expect(() => assertTestnetAnchorCompatibility(anchor(), 'native', 'SEP-10')).not.toThrow();
    expect(() => assertTestnetAnchorCompatibility(
      anchor({webAuthEndpoint: undefined}),
      'native',
      'SEP-10',
    )).toThrow(/SEP-10/);
  });

  it('never falls through to another network or anchor domain', () => {
    expect(() => assertTestnetAnchorCompatibility(
      anchor({networkPassphrase: Networks.PUBLIC}),
      'native',
    )).toThrow(/Testnet/);
    expect(() => assertTestnetAnchorCompatibility(
      anchor({homeDomain: 'evil.example.org'}),
      'native',
    )).toThrow(/configured/);
  });
});
