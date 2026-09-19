import {Keypair} from '@stellar/stellar-sdk';

const mockEnsureSmartWallet = jest.fn();
const mockHardwareDigestSigner = jest.fn((..._args: unknown[]) => ({kind: 'hardware'}));
jest.mock('../src/features/payments/smartWalletSettlement', () => ({
  ensureSmartWallet: (...args: unknown[]) => mockEnsureSmartWallet(...args),
  createHardwareDigestSigner: (...args: unknown[]) => mockHardwareDigestSigner(...args),
}));

const mockCreateCustomerSigner = jest.fn();
jest.mock('../src/features/wallet/walletSigner', () => ({
  createCustomerSigner: (...args: unknown[]) => mockCreateCustomerSigner(...args),
}));

const mockSettleOnTestnet = jest.fn();
jest.mock('../src/features/payments/testnetSettlement', () => ({
  settleOnTestnet: (...args: unknown[]) => mockSettleOnTestnet(...args),
  fetchRelayerIdentity: jest.fn(async () => ({
    address: 'GA4AB7OZST6NKRYNAJBIYBPV5ZAOIE4QYNEBTMVS6QBAMNVSQ3XGC22H',
    networkPassphrase: 'Test SDF Network ; September 2015',
    settlementContractId: 'CAV65DKNKPQZMY2MBXEDDBBCLMTVNIZUJVYFNDRUSKNCATIFKX66CSVO',
  })),
  createRemoteRelayerSigner: jest.fn(() => ({signTransaction: jest.fn()})),
}));

jest.mock('@rosapay/stellar', () => {
  const actual = jest.requireActual('@rosapay/stellar');
  return {
    ...actual,
    StellarRpcClient: class {
      async health() {
        return {latestLedger: 4_499_703};
      }
    },
  };
});

jest.mock('../src/features/payments/paymentLifecycle', () => ({
  createLifecycleReporter: jest.fn(() => ({record: jest.fn(), flush: jest.fn(async () => undefined)})),
}));

jest.mock('../src/features/payments/countersignature', () => ({
  selectCountersigner: jest.fn(() => jest.fn()),
}));

import {settlePaymentIntent} from '../src/features/payments/settlementAdapter';
import {useAppStore} from '../src/state/appStore';

const initial = useAppStore.getState();
const contractId = 'CCN6VR6CZO4KSSFCOWNIGXVUBHHJRFUG3UXJIVHBBGGN4DKD7KAJXXDL';
const devicePublicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 3)]).toString('base64');

/** A lira-priced request, which is what the app now actually produces. */
const payload = {
  intent: {
    version: 'RTP/1',
    intentId: '01K36YB37NXM4X4TECF0VKP1M9',
    network: 'testnet',
    merchantProfileId: '01K36YATYFVQBPR08G2YT29C3S',
    merchantName: 'Rosa Coffee',
    merchantSigningKey: 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57',
    recipient: contractId,
    asset: {type: 'native', code: 'XLM', decimals: 7},
    amount: '55.7413601',
    reference: 'Table 08 · 500.00 TRY',
    nonce: 'a'.repeat(32),
    expiresAtLedger: 4_499_823,
    createdAt: '2026-09-04T11:42:00.000Z',
  },
  signature: 'b'.repeat(88),
} as never;

describe('which account on this phone pays', () => {
  beforeEach(() => {
    useAppStore.setState({...initial, smartWallet: null, wallet: null, receipts: []});
    mockEnsureSmartWallet.mockReset().mockResolvedValue({contractId, devicePublicKey});
    mockCreateCustomerSigner.mockReset();
    mockSettleOnTestnet.mockReset().mockResolvedValue({transactionHash: 'c'.repeat(64), ledger: 4_499_710});
    mockHardwareDigestSigner.mockClear();
  });

  it('pays from the smart wallet when this phone made one', async () => {
    useAppStore.setState({smartWallet: {contractId, devicePublicKey}});

    await settlePaymentIntent(payload);

    const [input] = mockSettleOnTestnet.mock.calls[0] as [{customer: {kind: string; contractId?: string}}];
    expect(input.customer).toMatchObject({kind: 'smart-wallet', contractId});
    expect(mockCreateCustomerSigner).not.toHaveBeenCalled();
  });

  /**
   * The reason this branch exists: onboarding offers twelve words as well as a
   * smart wallet, and a wallet you cannot pay from is not a wallet. A classic
   * account signs the hashed preimage rather than authorizing the whole entry,
   * which is a different signature, not a different spelling of one.
   */
  it('pays from the recovery-phrase account when that is what this phone holds', async () => {
    const keypair = Keypair.random();
    useAppStore.setState({wallet: {address: keypair.publicKey(), origin: 'imported'}});
    const signer = {address: keypair.publicKey(), signAuthEntry: jest.fn()};
    mockCreateCustomerSigner.mockResolvedValue(signer);

    await settlePaymentIntent(payload);

    const [input] = mockSettleOnTestnet.mock.calls[0] as [{customer: {kind: string; address?: string}}];
    expect(input.customer).toMatchObject({kind: 'classic', address: keypair.publicKey()});
    // Deploying a smart wallet for someone who brought their own account would
    // fund and charge a second wallet they never asked for.
    expect(mockEnsureSmartWallet).not.toHaveBeenCalled();
  });

  it('names the amount and the merchant on the prompt the customer reads', async () => {
    const keypair = Keypair.random();
    useAppStore.setState({wallet: {address: keypair.publicKey(), origin: 'created'}});
    mockCreateCustomerSigner.mockResolvedValue({address: keypair.publicKey(), signAuthEntry: jest.fn()});

    await settlePaymentIntent(payload);

    expect(mockCreateCustomerSigner).toHaveBeenCalledWith('Approve 55.7413601 XLM to Rosa Coffee');
  });

  it('prefers the smart wallet when a phone somehow holds both', async () => {
    const keypair = Keypair.random();
    useAppStore.setState({
      smartWallet: {contractId, devicePublicKey},
      wallet: {address: keypair.publicKey(), origin: 'imported'},
    });

    await settlePaymentIntent(payload);

    const [input] = mockSettleOnTestnet.mock.calls[0] as [{customer: {kind: string}}];
    expect(input.customer.kind).toBe('smart-wallet');
  });
});
