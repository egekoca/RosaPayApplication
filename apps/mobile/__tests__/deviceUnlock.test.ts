import {p256} from '@noble/curves/nist.js';
import {Buffer} from 'buffer';

const mockSignDigest = jest.fn();
const mockGetIdentity = jest.fn();
jest.mock('../src/native/nativeSigner', () => ({
  createNativeRosaPaySigner: () => ({
    getIdentity: (...args: unknown[]) => mockGetIdentity(...args),
    signDigest: (...args: unknown[]) => mockSignDigest(...args),
  }),
}));

const mockHasSigningKey = jest.fn();
const mockLoadSigningKey = jest.fn();
jest.mock('../src/features/wallet/keyVault', () => {
  const actual = jest.requireActual('../src/features/wallet/keyVault');
  return {
    ...actual,
    hasSigningKey: (...args: unknown[]) => mockHasSigningKey(...args),
    loadSigningKey: (...args: unknown[]) => mockLoadSigningKey(...args),
  };
});

import {Keypair} from '@stellar/stellar-sdk';
import {unlockWithDevice} from '../src/features/onboarding/deviceUnlock';
import {useAppStore} from '../src/state/appStore';

const initial = useAppStore.getState();
const secret = p256.utils.randomSecretKey();
const devicePublicKey = Buffer.from(p256.getPublicKey(secret, false)).toString('base64');

/** Signs the challenge the way a platform keystore would: ASN.1 DER, not compact. */
function signLikeHardware({digest}: {digest: string}) {
  const compact = p256.sign(Uint8Array.from(Buffer.from(digest, 'base64')), secret, {prehash: false});
  const der = p256.Signature.fromBytes(compact).toBytes('der');
  return Promise.resolve({signature: Buffer.from(der).toString('base64')});
}

describe('unlocking the app', () => {
  beforeEach(() => {
    useAppStore.setState({...initial, smartWallet: null, wallet: null});
    mockGetIdentity.mockReset();
    mockSignDigest.mockReset();
    mockHasSigningKey.mockReset();
    mockLoadSigningKey.mockReset();
  });

  /**
   * The regression this exists for: unlock once looked only at the experimental
   * classic account, so every owner of the wallet the app actually creates was
   * told there was no key on the phone. The only button out of that screen
   * erases the account, and the smart wallet's key cannot be exported first.
   */
  it('asks the secure element when the account is a smart wallet', async () => {
    useAppStore.setState({
      smartWallet: {contractId: 'C'.repeat(56), devicePublicKey},
    });
    mockGetIdentity.mockResolvedValue({publicKey: devicePublicKey, kind: 'secp256r1'});
    mockSignDigest.mockImplementation(signLikeHardware);

    await expect(unlockWithDevice()).resolves.toEqual({ok: true});
    // The challenge is fresh, so a signature captured earlier proves nothing.
    expect(mockSignDigest).toHaveBeenCalledWith(
      expect.objectContaining({reason: 'Unlock Rosa Pay', digest: expect.any(String)}),
    );
    expect(mockHasSigningKey).not.toHaveBeenCalled();
  });

  it('refuses a signature that does not verify against the device key', async () => {
    useAppStore.setState({smartWallet: {contractId: 'C'.repeat(56), devicePublicKey}});
    const impostor = p256.utils.randomSecretKey();
    mockGetIdentity.mockResolvedValue({publicKey: devicePublicKey, kind: 'secp256r1'});
    mockSignDigest.mockImplementation(({digest}: {digest: string}) => {
      const compact = p256.sign(Uint8Array.from(Buffer.from(digest, 'base64')), impostor, {prehash: false});
      const der = p256.Signature.fromBytes(compact).toBytes('der');
      return Promise.resolve({signature: Buffer.from(der).toString('base64')});
    });

    await expect(unlockWithDevice()).resolves.toMatchObject({ok: false, reason: 'refused'});
  });

  it('reads the vault key when the account is the classic adapter', async () => {
    const keypair = Keypair.random();
    useAppStore.setState({wallet: {address: keypair.publicKey(), origin: 'imported'}});
    mockHasSigningKey.mockResolvedValue(true);
    mockLoadSigningKey.mockResolvedValue(keypair.secret());

    await expect(unlockWithDevice()).resolves.toEqual({ok: true});
    expect(mockGetIdentity).not.toHaveBeenCalled();
  });

  it('will not unlock a classic account with a key for a different address', async () => {
    useAppStore.setState({wallet: {address: Keypair.random().publicKey(), origin: 'imported'}});
    mockHasSigningKey.mockResolvedValue(true);
    mockLoadSigningKey.mockResolvedValue(Keypair.random().secret());

    await expect(unlockWithDevice()).resolves.toMatchObject({ok: false, reason: 'no-key'});
  });

  it('reports no key when the account holds neither', async () => {
    await expect(unlockWithDevice()).resolves.toMatchObject({ok: false, reason: 'no-key'});
  });
});
