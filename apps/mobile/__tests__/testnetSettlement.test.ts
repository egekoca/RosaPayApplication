import {StrKey} from '@stellar/stellar-sdk';
import {createStellarConfig, testnetDeployment} from '@rosapay/stellar';
import {useAppStore} from '../src/state/appStore';
import {
  assertRelayerIdentity,
  createRemoteRelayerSigner,
  fetchRelayerIdentity,
  TestnetSettlementError,
} from '../src/features/payments/testnetSettlement';

const config = createStellarConfig('testnet');
const relayer = {
  address: testnetDeployment.adminAddress,
  network: 'testnet' as const,
  networkPassphrase: config.networkPassphrase,
  settlementContractId: config.settlementContractId!,
};

function response(body: unknown, status = 200): Response {
  return {ok: status >= 200 && status < 300, status, json: jest.fn().mockResolvedValue(body)} as unknown as Response;
}

describe('Testnet relayer binding', () => {
  afterEach(() => useAppStore.setState({apiSession: null}));

  it('accepts only the configured network and settlement contract', () => {
    expect(() => assertRelayerIdentity(config, relayer)).not.toThrow();
    expect(() => assertRelayerIdentity(config, {
      ...relayer,
      settlementContractId: StrKey.encodeContract(Buffer.alloc(32, 9)),
    })).toThrow(new TestnetSettlementError('RELAYER_MISMATCH', 'The relayer identity does not match this Testnet deployment'));
  });

  it('carries the current device session to the relayer signer', async () => {
    useAppStore.setState({apiSession: {
      token: 'session-token',
      publicSigner: 'A'.repeat(64),
      expiresAt: '2099-01-01T00:00:00.000Z',
    }});
    const fetcher = jest.fn().mockResolvedValue(response({signedXdr: 'signed'}));
    await createRemoteRelayerSigner('https://api.example.com', fetcher).signTransaction('unsigned');
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.example.com/v1/relayer/transactions',
      expect.objectContaining({headers: expect.objectContaining({authorization: 'Bearer session-token'})}),
    );
  });

  it('rejects a malformed identity response before it can be used', async () => {
    await expect(fetchRelayerIdentity('https://api.example.com', jest.fn().mockResolvedValue(response({address: 'bad'}))))
      .rejects.toMatchObject({code: 'RELAYER_UNAVAILABLE'});
  });
});
