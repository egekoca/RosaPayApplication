import {createIntentIdentifiers, createPaymentIntent} from '@rosapay/protocol';
import {signMerchantIntent} from '@rosapay/stellar/merchant-signature';
import {createMerchantProfile} from '../src/features/merchant/merchantProfile';
import {createRandomBytes} from '../src/shared/randomBytes';
import {settlePaymentIntent} from '../src/features/payments/settlementAdapter';
import {useAppStore} from '../src/state/appStore';

const randomBytes = createRandomBytes({allowInsecureFallback: true});
function profile() {
  return createMerchantProfile(
    {displayName: 'Rose Coffee', recipient: 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57'},
    randomBytes,
  );
}

function request(merchant: ReturnType<typeof profile>) {
  const intent = createPaymentIntent({
    profile: {
      merchantProfileId: merchant.merchantProfileId,
      merchantName: merchant.displayName,
      merchantSigningKey: merchant.signingKey,
      recipient: merchant.recipient,
      network: 'testnet',
    },
    amount: '1',
    reference: 'Table 08',
    latestLedger: 1_500_000,
    ...createIntentIdentifiers(randomBytes),
    createdAt: new Date().toISOString(),
  });
  return {intent, signature: signMerchantIntent(intent, merchant.developmentSigningSecret)};
}

describe('mobile settlement adapter', () => {
  afterEach(() => {
    useAppStore.setState({merchantProfile: null, wallet: null});
  });

  it('reports a missing relayer instead of settling silently', async () => {
    const merchant = profile();
    // There is no local path left to fall back to, so an unreachable relayer has
    // to surface as a failure rather than as a payment that looks fine.
    await expect(settlePaymentIntent(request(merchant), {
      merchantProfile: merchant,
      baseUrl: 'http://127.0.0.1:1',
      latestLedger: 1_500_000,
    })).rejects.toMatchObject({code: 'RELAYER_UNAVAILABLE'});
  });
});
