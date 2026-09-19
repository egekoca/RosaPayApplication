import {ApiClientError} from '../src/api';
import {ensureSmartWallet} from '../src/features/payments/smartWalletSettlement';
import {useAppStore} from '../src/state/appStore';

const devicePublicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 3)]).toString('base64');
const contractId = 'CCAATSIEXIHVMYK7B6WGAGAHSBA4CL24XWCJ6RFW4X7MB53ZN2UELNE7';
const mockSigner = {
  getIdentity: jest.fn(),
  createIdentity: jest.fn(),
  signDigest: jest.fn(),
};

jest.mock('../src/native/nativeSigner', () => ({createNativeRosaPaySigner: () => mockSigner}));

const mockPasskey = {
  passkeysAvailable: jest.fn(),
  createPasskey: jest.fn(),
};
jest.mock('../src/features/wallet/passkey', () => ({
  ...jest.requireActual('../src/features/wallet/passkey'),
  passkeysAvailable: (...args: unknown[]) => mockPasskey.passkeysAvailable(...args),
  createPasskey: (...args: unknown[]) => mockPasskey.createPasskey(...args),
}));

const recoveryPasskey = {
  credentialId: 'Y3JlZA',
  publicKey: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 5)]).toString('base64'),
};

function api(overrides: {authDisabled?: boolean} = {}) {
  return {
    createDeviceChallenge: jest.fn(async () => {
      if (overrides.authDisabled) throw new ApiClientError('AUTHENTICATION_DISABLED', 'disabled', 503);
      return {
        challengeId: '12e5dc5b-1c7b-47be-8ca2-2fa49b558cd6',
        challenge: 'A'.repeat(44),
        expiresAt: '2026-09-03T12:05:00.000Z',
      };
    }),
    createDeviceSession: jest.fn(async () => ({token: 't'.repeat(64), expiresAt: '2099-09-03T12:15:00.000Z'})),
    provisionWallet: jest.fn(async () => ({
      walletContractId: contractId,
      devicePublicKey,
      transactionHash: 'a'.repeat(64),
      fundedAmount: '25',
    })),
  };
}

describe('mobile device session bootstrap', () => {
  beforeEach(() => {
    useAppStore.setState({smartWallet: null, apiSession: null});
    mockSigner.getIdentity.mockReset().mockResolvedValue({
      signerId: 'device', publicKey: devicePublicKey, kind: 'device-key',
    });
    mockSigner.createIdentity.mockReset();
    mockSigner.signDigest.mockReset().mockResolvedValue({
      signerId: 'device', signature: 'signed', signedAt: '2026-09-03T12:00:00.000Z',
    });
    mockPasskey.passkeysAvailable.mockReset().mockResolvedValue(true);
    mockPasskey.createPasskey.mockReset().mockResolvedValue(recoveryPasskey);
  });

  it('authenticates the hardware key before asking the API to provision its wallet', async () => {
    const client = api();
    await ensureSmartWallet(client as never);

    expect(client.createDeviceChallenge).toHaveBeenCalledWith(devicePublicKey);
    expect(mockSigner.signDigest).toHaveBeenCalledWith({digest: 'A'.repeat(44), reason: 'Sign in to Rosa Pay'});
    expect(client.createDeviceSession).toHaveBeenCalledWith(expect.objectContaining({
      publicSigner: devicePublicKey, signature: 'signed',
    }));
    expect(useAppStore.getState().apiSession).toMatchObject({
      token: 't'.repeat(64), publicSigner: devicePublicKey,
    });
    // A wallet is created with a recovery signer or it is one that dies with
    // the phone, so the passkey travels with the provisioning call.
    expect(client.provisionWallet).toHaveBeenCalledWith(devicePublicKey, {
      publicKey: recoveryPasskey.publicKey,
      credentialId: recoveryPasskey.credentialId,
      kind: 'Passkey',
    });
    expect(useAppStore.getState().smartWallet).toMatchObject({recovery: recoveryPasskey});
  });

  it('still creates a wallet on a phone that cannot hold a passkey, and says so', async () => {
    mockPasskey.passkeysAvailable.mockResolvedValue(false);
    const client = api();
    await ensureSmartWallet(client as never);

    expect(mockPasskey.createPasskey).not.toHaveBeenCalled();
    expect(client.provisionWallet).toHaveBeenCalledWith(devicePublicKey, undefined);
    // The absence is recorded rather than implied: this wallet has no way back.
    expect(useAppStore.getState().smartWallet?.recovery).toBeUndefined();
  });

  it('carries on when the customer dismisses the passkey prompt', async () => {
    mockPasskey.createPasskey.mockRejectedValue(
      Object.assign(new Error('dismissed'), {name: 'PasskeyError', code: 'USER_CANCELLED'}),
    );
    const client = api();
    await ensureSmartWallet(client as never);

    expect(client.provisionWallet).toHaveBeenCalledWith(devicePublicKey, undefined);
    expect(useAppStore.getState().smartWallet?.contractId).toBe(contractId);
  });

  it('reuses a fresh session without another biometric prompt', async () => {
    const client = api();
    useAppStore.setState({
      smartWallet: {contractId, devicePublicKey},
      apiSession: {token: 't'.repeat(64), publicSigner: devicePublicKey, expiresAt: '2099-09-03T12:15:00.000Z'},
    });

    await ensureSmartWallet(client as never);

    expect(client.createDeviceChallenge).not.toHaveBeenCalled();
    expect(mockSigner.signDigest).not.toHaveBeenCalled();
    expect(client.provisionWallet).not.toHaveBeenCalled();
  });

  it('keeps explicit anonymous local mode compatible', async () => {
    const client = api({authDisabled: true});
    await expect(ensureSmartWallet(client as never)).resolves.toMatchObject({contractId});
    expect(useAppStore.getState().apiSession).toBeNull();
  });
});
