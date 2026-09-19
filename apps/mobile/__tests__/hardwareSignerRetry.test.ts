import {createHardwareSigner} from '../src/features/settings/hardwareSigner';
import {ensureSmartWallet} from '../src/features/payments/smartWalletSettlement';
import {createNativeRosaPaySigner} from '../src/native/nativeSigner';

const mockNativeSigner = {
  getIdentity: jest.fn(),
  createIdentity: jest.fn(),
};

jest.mock('../src/native/nativeSigner', () => ({createNativeRosaPaySigner: jest.fn(() => mockNativeSigner)}));
jest.mock('../src/features/payments/smartWalletSettlement', () => ({ensureSmartWallet: jest.fn()}));

const mockedEnsureSmartWallet = jest.mocked(ensureSmartWallet);
const mockedCreateNativeSigner = jest.mocked(createNativeRosaPaySigner);

beforeEach(() => {
  jest.clearAllMocks();
  mockNativeSigner.getIdentity.mockResolvedValue({
    signerId: 'device',
    publicKey: 'existing-device-key',
    kind: 'device-key',
  });
  mockedEnsureSmartWallet.mockResolvedValue({
    contractId: 'CAFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUTSM',
    devicePublicKey: 'existing-device-key',
  });
});

it('reuses an existing native key when wallet provisioning is retried', async () => {
  await expect(createHardwareSigner()).resolves.toMatchObject({
    state: 'ready',
    publicKey: 'existing-device-key',
    walletContractId: 'CAFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUCQKBIFAUTSM',
  });

  expect(mockedCreateNativeSigner).toHaveBeenCalledTimes(1);
  expect(mockNativeSigner.getIdentity).toHaveBeenCalledTimes(1);
  expect(mockNativeSigner.createIdentity).not.toHaveBeenCalled();
  expect(mockedEnsureSmartWallet).toHaveBeenCalledTimes(1);
});
