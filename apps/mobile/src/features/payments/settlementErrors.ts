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
        // Every one of these is raised with a sentence already written for the
        // person holding the phone, and each names a different next move —
        // wait, ask for a new request, or fix the deployment. Collapsing them
        // into one line threw that away and, since the remote countersigner
        // exists precisely so another device can sign, said something false.
        return error.message || 'The merchant could not approve this payment.';
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

/**
 * The same failure in the words the code used, for someone who has to fix it.
 *
 * Every branch above ends in a sentence a customer can act on, and two of them
 * are reached by any failure that was not anticipated — so an unmapped error
 * arrives on screen as "the payment could not be completed" and takes its cause
 * with it. On a device that is the end of the investigation: there is no
 * console, and the person holding the phone has nothing to report but the
 * sentence. This is the line that makes the next attempt informative.
 *
 * Deliberately terse and deliberately secondary: it sits under the real message
 * in small type, and it never replaces it.
 */
export function settlementErrorDetail(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const code = (error as {code?: unknown}).code;
  const named = [error.name, typeof code === 'string' ? code : undefined].filter(Boolean).join(' · ');
  const message = error.message.trim();
  if (!message) return named || undefined;
  // Long enough to name a contract error or an HTTP status, short enough that
  // it stays a footnote rather than becoming the screen.
  const trimmed = message.length > 180 ? `${message.slice(0, 180)}…` : message;
  return named ? `${named}: ${trimmed}` : trimmed;
}
