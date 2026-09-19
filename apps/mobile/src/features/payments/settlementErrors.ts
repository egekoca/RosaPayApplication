import {SecureSignerError} from '@rosapay/secure-signer';
import {SettlementPipelineError, SettlementServiceError} from '@rosapay/stellar';
import {TestnetSettlementError} from './testnetSettlement';

/**
 * Turns settlement failures into something a payer can act on. Every branch says
 * what happened and what to do next; nothing is presented as a partial success.
 */
/**
 * @param assetCode what the payment was denominated in, so a shortfall names
 *   the asset the customer is actually short of.
 */
export function describeSettlementError(error: unknown, assetCode = 'XLM'): string {
  if (error instanceof TestnetSettlementError) {
    switch (error.code) {
      case 'RELAYER_UNAVAILABLE':
        return 'The Rosa Pay relayer is unreachable, so no fee payer could sign. Nothing was sent.';
      case 'RELAYER_MISMATCH':
        return 'The relayer is not bound to this Testnet deployment, so the payment was stopped.';
      case 'MERCHANT_KEY_UNAVAILABLE':
        return 'This request was created on another device, so its merchant signature cannot be produced here.';
      case 'CUSTOMER_ACCOUNT_UNAVAILABLE':
        return 'This device wallet could not be funded on Testnet. Try again in a moment.';
      default:
        return 'The payment could not be settled. No funds were moved.';
    }
  }

  if (error instanceof SettlementServiceError) {
    switch (error.code) {
      case 'INVALID_INTENT':
        return 'This request is no longer valid: it has expired or targets another network.';
      case 'INVALID_MERCHANT_SIGNATURE':
        return 'The merchant signature does not match this request. Ask for a new payment request.';
      case 'CONTRACT_SIGNATURE_REQUIRED':
        return 'The merchant has not signed this exact payment for your wallet yet.';
      case 'RELAYER_REQUIRED':
        return 'No separate fee payer was available, so the payment was not attempted.';
      default:
        return 'The payment could not be prepared. No funds were moved.';
    }
  }

  if (error instanceof SettlementPipelineError) {
    switch (error.code) {
      case 'CUSTOMER_AUTH_REQUIRED':
        return 'The contract refused to prepare this payment. It is most likely already settled or expired.';
      case 'SUBMISSION_FAILED':
        return 'Stellar rejected the transaction, so nothing was settled.';
      case 'CONFIRMATION_FAILED':
        return 'The transaction was sent but never confirmed. Check the merchant before paying again.';
      default:
        return 'The payment could not be completed. No funds were moved.';
    }
  }

  if (error instanceof SecureSignerError) {
    return error.code === 'USER_CANCELLED'
      ? 'You cancelled the authorization, so nothing was paid.'
      : 'This device could not authorize the payment. No funds were moved.';
  }

  // Network-level failures the Stellar dApp checklist calls out explicitly.
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('insufficient') || message.includes('underfunded')) {
    // Named from the intent. This used to say XLM whatever was being paid,
    // which sent a customer short of USDC off to top up the wrong asset.
    return `This wallet does not have enough ${assetCode} for the payment. Top it up and try again.`;
  }
  if (message.includes('account not found') || message.includes('notfound')) {
    return 'This wallet is not funded on Stellar yet. Create or fund it from developer settings.';
  }
  if (message.includes('network') || message.includes('fetch') || message.includes('timeout')) {
    return 'Stellar could not be reached, so nothing was submitted. Check the connection and try again.';
  }

  return 'The payment could not be completed. No funds were moved.';
}
