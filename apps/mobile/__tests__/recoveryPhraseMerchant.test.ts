import {ensureDeviceSession} from '../src/api/deviceSession';
import {useAppStore} from '../src/state/appStore';

/**
 * A merchant who onboarded with twelve words could not be paid.
 *
 * `ensureDeviceSession` read the native device key but never minted one, and
 * the only two places that did mint it — the smart wallet and wallet recovery —
 * are on paths a recovery-phrase account never walks. So every merchant-side
 * call that goes through this function (registering the signing key on the
 * settlement contract, publishing the request to the API, countersigning,
 * polling status) failed with "No payment key exists on this device", and the
 * contract then refused to settle for an unregistered merchant.
 *
 * The device key is created on demand here, which is what lets that account
 * reach the API at all.
 */
const devicePublicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 3)]).toString('base64');

const mockSigner = {
  getIdentity: jest.fn(),
  createIdentity: jest.fn(),
  signDigest: jest.fn(),
};

jest.mock('../src/native/nativeSigner', () => ({createNativeRosaPaySigner: () => mockSigner}));

function api() {
  return {
    createDeviceChallenge: jest.fn(async () => ({
      challengeId: '12e5dc5b-1c7b-47be-8ca2-2fa49b558cd6',
      challenge: 'A'.repeat(44),
      expiresAt: '2026-09-13T12:05:00.000Z',
    })),
    createDeviceSession: jest.fn(async () => ({token: 't'.repeat(64), expiresAt: '2099-09-13T12:15:00.000Z'})),
  };
}

describe('a recovery-phrase merchant reaching the API', () => {
  beforeEach(() => {
    useAppStore.setState({apiSession: null});
    mockSigner.getIdentity.mockReset().mockResolvedValue(null);
    mockSigner.createIdentity.mockReset().mockResolvedValue({
      signerId: 'device', publicKey: devicePublicKey, kind: 'device-key',
    });
    mockSigner.signDigest.mockReset().mockResolvedValue({
      signerId: 'device', signature: 'signed', signedAt: '2026-09-13T12:00:00.000Z',
    });
  });

  it('mints the device key on a phone that has never had one', async () => {
    const client = api();
    await expect(ensureDeviceSession(client as never)).resolves.toMatchObject({publicSigner: devicePublicKey});

    expect(mockSigner.createIdentity).toHaveBeenCalledWith('Rosa Pay');
    expect(client.createDeviceChallenge).toHaveBeenCalledWith(devicePublicKey);
    expect(useAppStore.getState().apiSession).toMatchObject({token: 't'.repeat(64)});
  });

  it('does not mint a second key when the phone already holds one', async () => {
    mockSigner.getIdentity.mockResolvedValue({
      signerId: 'device', publicKey: devicePublicKey, kind: 'device-key',
    });
    await ensureDeviceSession(api() as never);

    expect(mockSigner.createIdentity).not.toHaveBeenCalled();
  });

  /**
   * A phone with no screen lock cannot protect a key, and the native layer is
   * the only thing that knows that. Its wording has to survive, because
   * "set a screen lock" is the one message the customer can act on.
   */
  it('passes the native reason through when no key can be created', async () => {
    mockSigner.createIdentity.mockRejectedValue(
      Object.assign(new Error('This device has no usable screen lock, so a payment key cannot be protected'), {
        name: 'SecureSignerError', code: 'UNAVAILABLE',
      }),
    );

    await expect(ensureDeviceSession(api() as never)).rejects.toThrow(/screen lock/);
  });
});
