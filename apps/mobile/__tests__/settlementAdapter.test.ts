import {Keypair, StrKey} from '@stellar/stellar-sdk';
import {Buffer} from 'buffer';
import {createStellarConfig} from '@rosapay/stellar';
import {createIntentIdentifiers, createPaymentIntent} from '@rosapay/protocol';
import {signMerchantIntent} from '@rosapay/stellar/merchant-signature';
import {createMerchantProfile} from '../src/features/merchant/merchantProfile';
import {createRandomBytes} from '../src/shared/randomBytes';
import {settlePaymentIntent} from '../src/features/payments/settlementAdapter';
import {TestnetSettlementError} from '../src/features/payments/testnetSettlement';
import {useAppStore} from '../src/state/appStore';

const randomBytes = createRandomBytes({allowInsecureFallback: true});
const relayer = {
  address: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 9)),
  network: 'testnet',
  networkPassphrase: createStellarConfig('testnet').networkPassphrase,
  settlementContractId: StrKey.encodeContract(Buffer.alloc(32, 5)),
};

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
    useAppStore.setState({settlementMode: 'mock', merchantProfile: null, customerWallet: null});
  });

  it('keeps demo settlements local and labelled', async () => {
    const merchant = profile();
    const receipt = await settlePaymentIntent(request(merchant), {mode: 'mock'});

    expect(receipt.settlementMode).toBe('mock');
    expect(receipt.transactionHash.startsWith('demo:')).toBe(true);
  });

  it('reports a missing relayer instead of settling silently', async () => {
    const merchant = profile();
    await expect(settlePaymentIntent(request(merchant), {
      mode: 'testnet',
      merchantProfile: merchant,
      baseUrl: 'http://127.0.0.1:1',
      customer: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)),
      latestLedger: 1_500_000,
    })).rejects.toMatchObject({code: 'RELAYER_UNAVAILABLE'});
  });
});
