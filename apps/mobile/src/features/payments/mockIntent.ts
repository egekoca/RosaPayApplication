import type {SignedPaymentIntentV1} from '@rosapay/protocol';

export const mockSignedIntent: SignedPaymentIntentV1 = {
  intent: {
    version: 'RTP/1',
    intentId: '01K36YB37NXM4X4TECF0VKP1M9',
    network: 'testnet',
    merchantProfileId: '01K36YATYFVQBPR08G2YT29C3S',
    merchantName: 'Rose Coffee',
    merchantSigningKey: 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57',
    recipient: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    asset: {type: 'native', code: 'XLM', decimals: 7},
    amount: '24.5',
    reference: 'Table 08',
    nonce: 'b9cdb790ee6a4d04a83763c018f532a8',
    expiresAtLedger: 1_500_120,
    createdAt: '2026-08-21T00:00:00.000Z',
  },
  signature: '6yrxcjEiiNbaBYCDA4vhayb6ll75vBDsdiC4UysFEmX2K0YgpdRhqtvL6G51ztOqvKHp/24K8o4UXvJmBHG1Ag==',
};
