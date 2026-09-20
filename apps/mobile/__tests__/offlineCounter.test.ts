import {xdr} from '@stellar/stellar-sdk';
import {mockSignedIntent} from './fixtures/signedIntent';
import type {OfflineChannel} from '../src/features/payments/offlineChannel';
import {OfflineChannelError} from '../src/features/payments/offlineChannel';

const mockSettle = jest.fn();

jest.mock('@rosapay/stellar', () => {
  const actual = jest.requireActual('@rosapay/stellar');
  return {
    ...actual,
    createSettlementClient: () => ({
      intent_digest: async () => ({result: Buffer.alloc(32, 7)}),
    }),
    settleSignedPayment: (...args: unknown[]) => mockSettle(...args),
  };
});

import {settleOverCounter, OfflineCounterError} from '../src/features/merchant/offlineCounter';
import {createStellarConfig} from '@rosapay/stellar';

const customerAddress = 'CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L';
const relayer = {
  address: 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57',
  network: 'testnet' as const,
  networkPassphrase: 'Test SDF Network ; September 2015',
  settlementContractId: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
};

/** A real entry, so what crosses the radio is what the pipeline would hand over. */
function anEntry(): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: xdr.ScAddress.scAddressTypeContract(Buffer.alloc(32, 1) as never),
          functionName: 'settle_payment',
          args: [],
        }),
      ),
      subInvocations: [],
    }),
  });
}

function fakeChannel(answers: unknown[]): OfflineChannel & {sent: Array<{kind: string; body: never}>} {
  const sent: Array<{kind: string; body: never}> = [];
  return {
    sent,
    send: async (kind: string, body: never) => {
      sent.push({kind, body});
    },
    next: async () => {
      const queued = answers.shift();
      if (!queued) throw new OfflineChannelError('TIMED_OUT', 'nothing queued');
      return queued;
    },
    taken: () => null,
    close: () => undefined,
  } as never;
}

function input(channel: OfflineChannel) {
  return {
    payload: mockSignedIntent,
    customerAddress,
    config: createStellarConfig('testnet', {settlementContractId: relayer.settlementContractId}),
    relayer,
    relayerSigner: {signTransaction: async () => ({signedTxXdr: 'x'})},
    signingSecret: Uint8Array.from(Buffer.alloc(32, 3)),
    latestLedger: 1_500_000,
    channel,
  };
}

describe('taking a payment from a phone with no network', () => {
  beforeEach(() => jest.clearAllMocks());

  it('hands the customer the exact entry, and submits what comes back', async () => {
    const entry = anEntry();
    const signed = anEntry();
    const channel = fakeChannel([
      {
        v: 'RTP/1',
        intentId: mockSignedIntent.intent.intentId,
        authorizer: customerAddress,
        signatureExpirationLedger: 1_500_100,
        entryXdr: signed.toXDR('base64'),
      },
    ]);

    mockSettle.mockImplementation(async (options: never) => {
      const authorize = (options as {customerAuthorizeEntry: Function}).customerAuthorizeEntry;
      const returned = await authorize(entry, undefined, 1_500_100, relayer.networkPassphrase);
      expect(returned.toXDR('base64')).toBe(signed.toXDR('base64'));
      return {transactionHash: 'd'.repeat(64), ledger: 1_500_010};
    });

    const receipt = await settleOverCounter(input(channel));

    expect(channel.sent[0]).toMatchObject({kind: 'authRequest'});
    expect(channel.sent[0]!.body).toMatchObject({
      entryXdr: entry.toXDR('base64'),
      signatureExpirationLedger: 1_500_100,
      latestLedger: 1_500_000,
      settlementContractId: relayer.settlementContractId,
    });
    expect(receipt).toEqual({transactionHash: 'd'.repeat(64), ledger: 1_500_010});
  });

  it('refuses an approval signed by some other wallet', async () => {
    // The entry names who pays. An approval from anyone else is either a
    // mistake or an attempt to charge a wallet that never agreed to this.
    const channel = fakeChannel([
      {
        v: 'RTP/1',
        intentId: mockSignedIntent.intent.intentId,
        authorizer: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
        signatureExpirationLedger: 1_500_100,
        entryXdr: anEntry().toXDR('base64'),
      },
    ]);
    mockSettle.mockImplementation(async (options: never) =>
      (options as {customerAuthorizeEntry: Function}).customerAuthorizeEntry(
        anEntry(),
        undefined,
        1_500_100,
        relayer.networkPassphrase,
      ),
    );

    await expect(settleOverCounter(input(channel))).rejects.toMatchObject({code: 'WRONG_CUSTOMER'});
  });

  it('refuses an approval about a different payment', async () => {
    const channel = fakeChannel([
      {
        v: 'RTP/1',
        intentId: 'another-intent',
        authorizer: customerAddress,
        signatureExpirationLedger: 1_500_100,
        entryXdr: anEntry().toXDR('base64'),
      },
    ]);
    mockSettle.mockImplementation(async (options: never) =>
      (options as {customerAuthorizeEntry: Function}).customerAuthorizeEntry(
        anEntry(),
        undefined,
        1_500_100,
        relayer.networkPassphrase,
      ),
    );

    await expect(settleOverCounter(input(channel))).rejects.toMatchObject({code: 'NOT_AUTHORIZED'});
  });

  it('will not submit something it cannot read as an authorization', async () => {
    const channel = fakeChannel([
      {
        v: 'RTP/1',
        intentId: mockSignedIntent.intent.intentId,
        authorizer: customerAddress,
        signatureExpirationLedger: 1_500_100,
        entryXdr: 'not base64 xdr',
      },
    ]);
    mockSettle.mockImplementation(async (options: never) =>
      (options as {customerAuthorizeEntry: Function}).customerAuthorizeEntry(
        anEntry(),
        undefined,
        1_500_100,
        relayer.networkPassphrase,
      ),
    );

    await expect(settleOverCounter(input(channel))).rejects.toBeInstanceOf(OfflineCounterError);
  });
});
