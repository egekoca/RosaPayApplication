import {Buffer} from 'buffer';
import {ApiClientError, RosaPayApiClient} from '../src/api/client';
import {
  localCountersigner,
  remoteCountersigner,
  selectCountersigner,
} from '../src/features/payments/countersignature';

const customerAddress = 'GDZ4ZAYGLEACS52ADRTWCDNDGZTWZRGYRV2QICRQ6YQU4Y4HTIQSM5F5';
const digest = Uint8Array.from(Buffer.alloc(32, 7));
const signature = Buffer.alloc(64, 3).toString('base64');
const noSleep = () => Promise.resolve();

function clientWith(overrides: Partial<RosaPayApiClient>): RosaPayApiClient {
  return {
    requestCountersignature: jest.fn().mockResolvedValue({customerAddress, requestedAt: 'now'}),
    getCountersignature: jest.fn(),
    ...overrides,
  } as unknown as RosaPayApiClient;
}

describe('a customer waiting for the merchant to countersign', () => {
  it('uses a signature that was already waiting, without polling', async () => {
    const getCountersignature = jest.fn();
    const client = clientWith({
      requestCountersignature: jest.fn().mockResolvedValue({customerAddress, signature, requestedAt: 'now'}),
      getCountersignature,
    });

    const result = await remoteCountersigner(client, {sleep: noSleep})({
      intentId: 'i',
      customerAddress,
      digest,
    });

    expect(Buffer.from(result).toString('base64')).toBe(signature);
    expect(getCountersignature).not.toHaveBeenCalled();
  });

  it('waits until the merchant has signed', async () => {
    const getCountersignature = jest
      .fn()
      .mockResolvedValueOnce({customerAddress, requestedAt: 'now'})
      .mockResolvedValueOnce({customerAddress, requestedAt: 'now'})
      .mockResolvedValueOnce({customerAddress, signature, requestedAt: 'now', signedAt: 'later'});
    const client = clientWith({getCountersignature});

    const result = await remoteCountersigner(client, {sleep: noSleep})({
      intentId: 'i',
      customerAddress,
      digest,
    });

    expect(Buffer.from(result).toString('base64')).toBe(signature);
    expect(getCountersignature).toHaveBeenCalledTimes(3);
  });

  it('gives up with something the customer can act on', async () => {
    const client = clientWith({
      getCountersignature: jest.fn().mockResolvedValue({customerAddress, requestedAt: 'now'}),
    });

    // A short deadline stands in for a merchant who walked away.
    await expect(
      remoteCountersigner(client, {sleep: noSleep, timeoutMs: 5})({intentId: 'i', customerAddress, digest}),
    ).rejects.toThrow(/did not approve this payment in time/);
  });

  it('keeps waiting through a server hiccup rather than failing the payment', async () => {
    const getCountersignature = jest
      .fn()
      .mockRejectedValueOnce(new ApiClientError('SERVER_ERROR', 'oops', 503))
      .mockResolvedValueOnce({customerAddress, signature, requestedAt: 'now'});
    const client = clientWith({getCountersignature});

    const result = await remoteCountersigner(client, {sleep: noSleep})({
      intentId: 'i',
      customerAddress,
      digest,
    });

    expect(Buffer.from(result).toString('base64')).toBe(signature);
  });

  it('stops immediately when someone else is already paying the request', async () => {
    const client = clientWith({
      requestCountersignature: jest
        .fn()
        .mockRejectedValue(new ApiClientError('COUNTERSIGNATURE_CONFLICT', 'taken', 409)),
    });

    await expect(
      remoteCountersigner(client, {sleep: noSleep})({intentId: 'i', customerAddress, digest}),
    ).rejects.toThrow(/Someone else is already paying/);
  });

  it('says so when the merchant never published the request', async () => {
    const client = clientWith({
      requestCountersignature: jest.fn().mockRejectedValue(new ApiClientError('NOT_FOUND', 'gone', 404)),
    });

    await expect(
      remoteCountersigner(client, {sleep: noSleep})({intentId: 'i', customerAddress, digest}),
    ).rejects.toThrow(/has not published this request/);
  });
});

describe('a merchant paying its own request', () => {
  it('signs on this device without a round trip', async () => {
    const profile = {developmentSigningSecret: Uint8Array.from(Buffer.alloc(32, 9))} as never;
    const signed = await localCountersigner(profile)({intentId: 'i', customerAddress, digest});
    expect(signed).toHaveLength(64);
  });
});

describe('choosing who signs for the merchant', () => {
  const merchantSigningKey = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
  const profile = (signingKey: string) =>
    ({signingKey, developmentSigningSecret: Uint8Array.from(Buffer.alloc(32, 9))}) as never;

  it('signs here when this device is the merchant that made the request', async () => {
    const client = clientWith({});
    const countersign = selectCountersigner({
      merchantProfile: profile(merchantSigningKey),
      merchantSigningKey,
      baseUrl: 'http://127.0.0.1:4100',
      client,
    });

    await countersign({intentId: 'i', customerAddress, digest});
    expect(client.requestCountersignature).not.toHaveBeenCalled();
  });

  it('asks the merchant when the request came from another device', async () => {
    const client = clientWith({
      requestCountersignature: jest.fn().mockResolvedValue({customerAddress, signature, requestedAt: 'now'}),
    });
    const countersign = selectCountersigner({
      merchantProfile: profile('GAP2SKMN74QKHUXPZZ36LIDVUBEETH56IWUJ62OIAU2OENHGHSSOWLYF'),
      merchantSigningKey,
      baseUrl: 'http://127.0.0.1:4100',
      client,
    });

    await countersign({intentId: 'i', customerAddress, digest});
    // The customer's phone has no merchant key, so this used to be refused
    // outright and a two-phone payment was impossible.
    expect(client.requestCountersignature).toHaveBeenCalledWith('i', customerAddress);
  });

  it('asks the merchant when this device has no business profile at all', async () => {
    const client = clientWith({
      requestCountersignature: jest.fn().mockResolvedValue({customerAddress, signature, requestedAt: 'now'}),
    });
    const countersign = selectCountersigner({
      merchantProfile: null,
      merchantSigningKey,
      baseUrl: 'http://127.0.0.1:4100',
      client,
    });

    await countersign({intentId: 'i', customerAddress, digest});
    expect(client.requestCountersignature).toHaveBeenCalled();
  });
});
