import {Buffer} from 'buffer';
import {ApiClientError, RosaPayApiClient, defaultClientTimeoutMs} from '../src/api/client';
import {
  claimTimeoutMs,
  localCountersigner,
  remoteCountersigner,
  selectCountersigner,
} from '../src/features/payments/countersignature';

jest.mock('../src/api/deviceSession', () => ({ensureDeviceSession: jest.fn().mockResolvedValue(null)}));
const {ensureDeviceSession} = jest.requireMock('../src/api/deviceSession') as {
  ensureDeviceSession: jest.Mock;
};

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

  it('signs in before claiming, because the claim is an authenticated call', async () => {
    // The one place in the paying flow that never established a session. A
    // customer who onboarded with twelve words has a classic account, so
    // nothing else on their phone had minted the device key a session is signed
    // with: the claim went out bare and the payment died at its first step.
    const request = jest.fn().mockResolvedValue({intentId: 'intent-1', customerAddress: 'GABC', signature: 'AQI='});
    const countersign = remoteCountersigner({
      requestCountersignature: request,
      getCountersignature: jest.fn(),
    } as never);

    await countersign({intentId: 'intent-1', customerAddress: 'GABC', digest: new Uint8Array(32)});
    expect(ensureDeviceSession).toHaveBeenCalled();
  });

  it('still claims when a session cannot be minted, and lets the API answer', async () => {
    // A deployment can have authentication switched off. Refusing to try would
    // deny a payment the API would have accepted.
    (ensureDeviceSession as jest.Mock).mockRejectedValueOnce(new Error('no screen lock'));
    const request = jest.fn().mockResolvedValue({intentId: 'intent-1', customerAddress: 'GABC', signature: 'AQI='});
    const countersign = remoteCountersigner({
      requestCountersignature: request,
      getCountersignature: jest.fn(),
    } as never);

    await expect(
      countersign({intentId: 'intent-1', customerAddress: 'GABC', digest: new Uint8Array(32)}),
    ).resolves.toBeInstanceOf(Uint8Array);
    expect(request).toHaveBeenCalled();
  });

  it('says a session was the missing piece rather than shrugging', async () => {
    const request = jest.fn().mockRejectedValue(
      new ApiClientError('AUTHENTICATION_REQUIRED', 'nope', 401),
    );
    const countersign = remoteCountersigner({
      requestCountersignature: request,
      getCountersignature: jest.fn(),
    } as never);

    await expect(
      countersign({intentId: 'intent-1', customerAddress: 'GABC', digest: new Uint8Array(32)}),
    ).rejects.toThrow('could not sign in');
  });

  it('gives the claim long enough to outlast a sleeping host', async () => {
    /*
     * Claiming is the first call a payment makes, so it is the one that pays
     * for a cold start. The client's ten-second default spends about
     * thirty-one seconds over its three attempts, and a cold start on the free
     * host measured twelve to forty-two — so the slow half of that range failed
     * a payment that would otherwise have gone through, after the customer had
     * already pressed Approve. Nothing is signed or spent at this point, so
     * waiting is the right failure.
     *
     * Asserting the constant alone would not catch the claim being built with
     * the default anyway, so this watches the abort signal the request actually
     * carries: a host that never answers must still be waited on past the point
     * the default would have given up.
     */
    const aborts: number[] = [];
    jest.useFakeTimers();
    jest.spyOn(global, 'fetch').mockImplementation(((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborts.push(Date.now());
          reject(new Error('aborted'));
        });
      })) as never);

    const countersign = selectCountersigner({
      merchantProfile: null,
      merchantSigningKey,
      baseUrl: 'http://127.0.0.1:4100',
    });
    const pending = countersign({intentId: 'i', customerAddress, digest}).catch(() => 'failed');

    // Where the default would have abandoned the claim, this one is still open.
    await jest.advanceTimersByTimeAsync(defaultClientTimeoutMs + 1_000);
    expect(aborts).toHaveLength(0);

    // And it does eventually give up, rather than hanging forever. The client
    // retries a timeout, so this has to outlast every attempt it is allowed.
    await jest.advanceTimersByTimeAsync(claimTimeoutMs * 4);
    expect(aborts.length).toBeGreaterThan(0);

    await expect(pending).resolves.toBe('failed');
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
});
