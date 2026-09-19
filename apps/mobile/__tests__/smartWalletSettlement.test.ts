import {ensureSmartWallet, SmartWalletError} from '../src/features/payments/smartWalletSettlement';
import {useAppStore} from '../src/state/appStore';

const contractId = 'CCAATSIEXIHVMYK7B6WGAGAHSBA4CL24XWCJ6RFW4X7MB53ZN2UELNE7';
const devicePublicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 3)]).toString('base64');

jest.mock('../src/native/nativeSigner', () => ({
  createNativeRosaPaySigner: () => globalThis.__signerMock,
}));

declare global {
  // eslint-disable-next-line no-var
  var __signerMock: {getIdentity: jest.Mock; signDigest: jest.Mock};
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

  it('says which step is missing when the device has no payment key', async () => {
    globalThis.__signerMock.getIdentity = jest.fn(async () => null);

    await expect(ensureSmartWallet(apiClient())).rejects.toMatchObject({code: 'DEVICE_KEY_MISSING'});
  });

  it('reports a provisioning failure instead of settling without a wallet', async () => {
    await expect(ensureSmartWallet(apiClient({fail: true}))).rejects.toBeInstanceOf(SmartWalletError);
  });
});
