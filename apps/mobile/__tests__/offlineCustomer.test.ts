import {mockSignedIntent} from './fixtures/signedIntent';
import type {OfflineChannel} from '../src/features/payments/offlineChannel';
import {OfflineChannelError} from '../src/features/payments/offlineChannel';

const mockAuthorizeOffline = jest.fn();

jest.mock('@rosapay/stellar', () => ({
  ...jest.requireActual('@rosapay/stellar'),
  authorizeOffline: (...args: unknown[]) => mockAuthorizeOffline(...args),
}));

jest.mock('../src/features/payments/smartWalletSettlement', () => ({
  createHardwareDigestSigner: (publicKey: string) => ({publicKey, signDigest: jest.fn()}),
}));

const mockCreateCustomerSigner = jest.fn();
jest.mock('../src/features/wallet/walletSigner', () => ({
  createCustomerSigner: (...args: unknown[]) => mockCreateCustomerSigner(...args),
}));

import {payOfflineOverCounter, OfflineCustomerError} from '../src/features/payments/offlineCustomer';
import {useAppStore} from '../src/state/appStore';

const wallet = {
  contractId: 'CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L',
  devicePublicKey: 'BASE64DEVICEKEY',
};
const intentId = mockSignedIntent.intent.intentId;

/**
 * The radio, without a radio.
 *
 * `next` is answered from whatever the test queued, so the order the customer
 * speaks in is what is actually under test rather than the transport.
 */
function fakeChannel(answers: Partial<Record<string, unknown[]>>): OfflineChannel & {sent: Array<{kind: string; body: unknown}>} {
  const sent: Array<{kind: string; body: unknown}> = [];
  return {
    sent,
    send: async (kind: string, body: unknown) => {
      sent.push({kind, body});
    },
    next: async (kind: string) => {
      const queued = answers[kind];
      if (!queued || queued.length === 0) {
        throw new OfflineChannelError('TIMED_OUT', `nothing queued for ${kind}`);
      }
      return queued.shift();
    },
    taken: () => null,
    close: () => undefined,
  } as never;
}

const offer = {
  v: 'RTP/1' as const,
  intentId,
  networkPassphrase: 'Test SDF Network ; September 2015',
  settlementContractId: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
  entryXdr: 'AAAAAQ==',
  signatureExpirationLedger: 1_500_100,
  latestLedger: 1_500_000,
};

describe('paying with no network, from the customer side', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAppStore.setState({smartWallet: wallet, wallet: null} as never);
    mockCreateCustomerSigner.mockResolvedValue({signAuthEntry: jest.fn()});
    mockAuthorizeOffline.mockResolvedValue({
      version: 'RTP/1',
      authorizer: wallet.contractId,
      signatureExpirationLedger: offer.signatureExpirationLedger,
      entryXdr: 'AAAAAg==',
    });
  });

  it('claims the request, signs what comes back, and returns the merchant receipt', async () => {
    const channel = fakeChannel({
      authRequest: [offer],
      result: [{
        v: 'RTP/1',
        intentId,
        status: 'confirmed',
        transactionHash: 'b'.repeat(64),
        ledger: 1_500_010,
      }],
    });
    const stages: string[] = [];

    const receipt = await payOfflineOverCounter({
      payload: mockSignedIntent,
      peerId: 'merchant-1',
      channel,
      onStage: stage => stages.push(stage),
    });

    // The payer goes first: the invocation names who pays, so the merchant can
    // build nothing until it arrives.
    expect(channel.sent.map(message => message.kind)).toEqual(['payer', 'authorization']);
    expect(channel.sent[0]!.body).toMatchObject({payer: wallet.contractId, intentId});
    expect(channel.sent[1]!.body).toMatchObject({entryXdr: 'AAAAAg==', authorizer: wallet.contractId});
    expect(stages).toEqual(['claiming', 'authorizing', 'signing', 'submitting', 'confirmed']);
    expect(receipt).toMatchObject({
      intentId,
      status: 'confirmed',
      transactionHash: 'b'.repeat(64),
      ledger: 1_500_010,
      transport: 'ble',
    });
  });

  it('signs nothing without a network, and reads the ledger it was handed', async () => {
    const channel = fakeChannel({
      authRequest: [offer],
      result: [{v: 'RTP/1', intentId, status: 'confirmed', transactionHash: 'c'.repeat(64)}],
    });
    await payOfflineOverCounter({payload: mockSignedIntent, peerId: 'merchant-1', channel});

    // The merchant's ledger is passed through to the check, because this phone
    // has no way to read one for itself.
    expect(mockAuthorizeOffline).toHaveBeenCalledWith(
      expect.objectContaining({
        customerAddress: wallet.contractId,
        latestLedger: offer.latestLedger,
        request: expect.objectContaining({entryXdr: offer.entryXdr}),
      }),
    );
  });

  it('refuses an offer about some other payment', async () => {
    const channel = fakeChannel({authRequest: [{...offer, intentId: 'another-intent'}]});

    await expect(
      payOfflineOverCounter({payload: mockSignedIntent, peerId: 'merchant-1', channel}),
    ).rejects.toMatchObject({code: 'WRONG_REQUEST'});
    expect(mockAuthorizeOffline).not.toHaveBeenCalled();
    // The merchant is told, rather than left waiting out its whole budget.
    expect(channel.sent.at(-1)).toMatchObject({kind: 'decline'});
  });

  it('says a merchant cannot do this, rather than waiting in silence', async () => {
    const channel = fakeChannel({});

    await expect(
      payOfflineOverCounter({payload: mockSignedIntent, peerId: 'merchant-1', channel}),
    ).rejects.toMatchObject({code: 'NOT_OFFERED'});
  });

  it('reports a failed settlement as a failure, never as a payment', async () => {
    const channel = fakeChannel({
      authRequest: [offer],
      result: [{v: 'RTP/1', intentId, status: 'failed', message: 'The wallet cannot cover this'}],
    });

    await expect(
      payOfflineOverCounter({payload: mockSignedIntent, peerId: 'merchant-1', channel}),
    ).rejects.toMatchObject({code: 'FAILED', message: 'The wallet cannot cover this'});
  });

  it('pays from a recovery-phrase account too, with the key already on the phone', async () => {
    // The key is on this phone either way — in the enclave for a wallet this
    // app made, in the keychain for one restored from twelve words. Signing an
    // authorization entry is local in both cases, which is exactly what a
    // browser wallet extension does, so refusing one of them was arbitrary.
    const classic = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
    useAppStore.setState({smartWallet: null, wallet: {address: classic}} as never);
    mockAuthorizeOffline.mockResolvedValue({
      version: 'RTP/1',
      authorizer: classic,
      signatureExpirationLedger: offer.signatureExpirationLedger,
      entryXdr: 'AAAAAg==',
    });
    const accountSigner = {signAuthEntry: jest.fn()};
    mockCreateCustomerSigner.mockResolvedValue(accountSigner);
    const channel = fakeChannel({
      authRequest: [offer],
      result: [{v: 'RTP/1', intentId, status: 'confirmed', transactionHash: 'e'.repeat(64)}],
    });

    const receipt = await payOfflineOverCounter({
      payload: mockSignedIntent,
      peerId: 'merchant-1',
      channel,
    });

    // It names itself as a classic account, and signs the preimage rather than
    // a digest — the device prompt is raised by the key store, not by an enclave.
    expect(channel.sent[0]!.body).toMatchObject({payer: classic, account: 'classic'});
    expect(mockAuthorizeOffline).toHaveBeenCalledWith(
      expect.objectContaining({customerAddress: classic, accountSigner}),
    );
    expect(receipt.transactionHash).toBe('e'.repeat(64));
  });

  it('says so when this phone holds no account at all', async () => {
    useAppStore.setState({smartWallet: null, wallet: null} as never);
    const channel = fakeChannel({authRequest: [offer]});

    await expect(
      payOfflineOverCounter({payload: mockSignedIntent, peerId: 'merchant-1', channel}),
    ).rejects.toMatchObject({code: 'NO_WALLET'});
  });
});
