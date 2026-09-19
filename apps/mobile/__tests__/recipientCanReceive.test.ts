import {Asset} from '@stellar/stellar-sdk';
import {canReceiveAsset, createStellarConfig, type readAssetBalance} from '@rosapay/stellar';

const mockRead = jest.fn<ReturnType<typeof readAssetBalance>, Parameters<typeof readAssetBalance>>();
const config = createStellarConfig('testnet');
const usdc = new Asset('USDC', 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5').contractId(
  config.networkPassphrase,
);

describe('whether an address can be paid in an asset', () => {
  beforeEach(() => mockRead.mockReset());

  it('says yes when the token will report a balance, even an empty one', async () => {
    // A contract account holds a SAC balance without any trustline, so zero is
    // the ordinary answer for one that has simply not been paid yet.
    mockRead.mockResolvedValue('0');

    await expect(canReceiveAsset(config, 'CBI3H4ROVXGJG3BRPABD2TKSIME2VJCJTKEMOCJNF3BNHYJOBK6U57NS', usdc, undefined, mockRead)).resolves.toBe(
      true,
    );
  });

  it('says no when the token refuses to report one at all', async () => {
    // Which is what a classic account without a trustline does: the balance
    // call fails outright rather than returning zero.
    mockRead.mockRejectedValue(new Error('The balance could not be read'));

    await expect(canReceiveAsset(config, 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57', usdc, undefined, mockRead)).resolves.toBe(
      false,
    );
  });

  it('treats an unreachable network as cannot, not as can', async () => {
    // Refusing to offer an asset costs a merchant a choice; offering one that
    // cannot arrive costs them a sale with the customer already committed.
    mockRead.mockRejectedValue(new Error('fetch failed'));

    await expect(canReceiveAsset(config, 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57', usdc, undefined, mockRead)).resolves.toBe(
      false,
    );
  });
});
