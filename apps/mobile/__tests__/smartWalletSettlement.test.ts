import {ensureSmartWallet, SmartWalletError} from '../src/features/payments/smartWalletSettlement';
import {useAppStore} from '../src/state/appStore';

const contractId = 'CCAATSIEXIHVMYK7B6WGAGAHSBA4CL24XWCJ6RFW4X7MB53ZN2UELNE7';
const devicePublicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 3)]).toString('base64');

jest.mock('../src/native/nativeSigner', () => ({
  createNativeRosaPaySigner: () => globalThis.__signerMock,
}));
// Provisioning now signs in first. That exchange has its own tests; here it
// only has to succeed so the wallet behaviour underneath stays visible.
jest.mock('../src/api/deviceSession', () => ({
  ensureDeviceSession: jest.fn(async () => null),
}));

declare global {
  // eslint-disable-next-line no-var
  var __signerMock: {getIdentity: jest.Mock; createIdentity: jest.Mock; signDigest: jest.Mock};
}

function apiClient(overrides: {fail?: boolean} = {}) {
  return {
    provisionWallet: jest.fn(async () => {
      if (overrides.fail) throw new Error('relayer is down');
      return {
        walletContractId: contractId,
        devicePublicKey,
        transactionHash: 'a'.repeat(64),
        fundedAmount: '25',
      };
    }),
  } as never;
}

describe('smart wallet provisioning', () => {
  beforeEach(() => {
    useAppStore.setState({smartWallet: null});
    globalThis.__signerMock = {
      getIdentity: jest.fn(async () => ({signerId: 'device', publicKey: devicePublicKey, kind: 'device-key'})),
      createIdentity: jest.fn(async () => ({signerId: 'device', publicKey: devicePublicKey, kind: 'device-key'})),
      signDigest: jest.fn(),
    };
  });

  it('deploys a wallet once and reuses it for the same device key', async () => {
    const client = apiClient();
    const first = await ensureSmartWallet(client);
    const second = await ensureSmartWallet(client);

    expect(first.contractId).toBe(contractId);
    expect(second).toEqual(first);
    expect((client as unknown as {provisionWallet: jest.Mock}).provisionWallet).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().smartWallet).toEqual(first);
  });

  it('provisions again when the device key changed', async () => {
    const client = apiClient();
    useAppStore.setState({smartWallet: {contractId: 'COLD', devicePublicKey: 'other-key'}});

    const wallet = await ensureSmartWallet(client);

    expect(wallet.contractId).toBe(contractId);
    expect((client as unknown as {provisionWallet: jest.Mock}).provisionWallet).toHaveBeenCalledTimes(1);
  });

  it('makes the payment key at the first payment rather than refusing', async () => {
    // Signing up no longer demands a key, so this is where one has to appear.
    globalThis.__signerMock.getIdentity = jest.fn(async () => null);

    const wallet = await ensureSmartWallet(apiClient());

    expect(globalThis.__signerMock.createIdentity).toHaveBeenCalled();
    expect(wallet.contractId).toBe(contractId);
  });

  it('says what to do when the phone cannot hold a payment key at all', async () => {
    // Android refuses a key that requires the owner unless a screen lock is
    // set, and that is something a person can go and fix.
    globalThis.__signerMock.getIdentity = jest.fn(async () => null);
    globalThis.__signerMock.createIdentity = jest.fn(async () => {
      throw new Error('no screen lock');
    });

    await expect(ensureSmartWallet(apiClient())).rejects.toMatchObject({
      code: 'DEVICE_KEY_MISSING',
      message: expect.stringContaining('screen lock'),
    });
  });

  it('reports a provisioning failure instead of settling without a wallet', async () => {
    await expect(ensureSmartWallet(apiClient({fail: true}))).rejects.toBeInstanceOf(SmartWalletError);
  });
});
