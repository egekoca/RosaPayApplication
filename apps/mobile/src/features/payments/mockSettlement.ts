import {hashPaymentIntent, type SignedPaymentIntentV1} from '@rosapay/protocol';
import {transitionPayment, type Payment} from '@rosapay/domain';
import type {PaymentAuthorizationRequest, SecureSigner, SignerIdentity} from '@rosapay/secure-signer';
import type {LocalReceipt} from '../../state/appStore';

const wait = (duration: number) => new Promise(resolve => setTimeout(resolve, duration));

class DemoBiometricSigner implements SecureSigner {
  async getIdentity(): Promise<SignerIdentity> {
    return {signerId: 'device-demo', publicKey: 'opaque-native-key', kind: 'mock'};
  }
  async createIdentity(): Promise<SignerIdentity> {
    return this.getIdentity();
  }
  async authorizePayment(request: PaymentAuthorizationRequest) {
    await wait(650);
    return {signerId: 'device-demo', authorization: `mock:${request.intentHash}`, authorizedAt: new Date().toISOString()};
  }
}

const signer = new DemoBiometricSigner();

export async function settleMockPayment(payload: SignedPaymentIntentV1): Promise<LocalReceipt> {
  const intentHash = hashPaymentIntent(payload.intent);
  let payment: Payment = {intentId: payload.intent.intentId, status: 'awaiting_approval'};
  await signer.authorizePayment({
    intentId: payload.intent.intentId,
    intentHash,
    network: payload.intent.network,
    settlementContractId: 'CDEMOSETTLEMENTCONTRACT',
  });
  payment = transitionPayment(payment, 'authorized');
  payment = transitionPayment(payment, 'submitted');
  await wait(500);
  payment = transitionPayment(payment, 'confirmed');
  return {
    intentId: payload.intent.intentId,
    merchantName: payload.intent.merchantName,
    recipient: payload.intent.recipient,
    amount: payload.intent.amount,
    assetCode: payload.intent.asset.code,
    network: payload.intent.network,
    payloadHash: intentHash,
    status: payment.status,
    // Deliberately not hash-shaped: nothing was submitted to Stellar.
    transactionHash: `demo:${intentHash.slice(0, 16)}`,
    createdAt: new Date().toISOString(),
    settlementMode: 'mock',
  };
}
