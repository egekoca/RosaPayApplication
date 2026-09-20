import {hashPaymentIntent, type SignedPaymentIntentV1} from '@rosapay/protocol';
import {authorizeOffline, type UnsignedAuthRequest} from '@rosapay/stellar';
import {createCustomerSigner} from '../wallet/walletSigner';
import type {LocalReceipt} from '../../state/appStore';
import {useAppStore} from '../../state/appStore';
import {logger} from '../../shared/logger';
import {openOfflineChannel, OfflineChannelError, type OfflineChannel} from './offlineChannel';
import {createHardwareDigestSigner} from './smartWalletSettlement';

/**
 * Paying with no network at all, from the customer's side.
 *
 * The merchant is the half that is online, so it does everything that needs a
 * chain: it simulates the settlement, works out the exact invocation, submits
 * it and watches for confirmation. What crosses the radio to this phone is the
 * one thing only this phone can produce — a signature over that invocation.
 *
 * Nothing the merchant sends is believed. The entry is rebuilt locally from the
 * merchant-signed request already on screen and compared field by field before
 * the device is asked for anything, so an entry that pays a different amount,
 * a different recipient or out of a different wallet never reaches Face ID.
 */
export type OfflineCustomerStage =
  | 'claiming'
  | 'authorizing'
  | 'signing'
  | 'submitting'
  | 'confirmed';

export class OfflineCustomerError extends Error {
  override readonly name = 'OfflineCustomerError';
  constructor(
    readonly code:
      | 'NO_WALLET'
      | 'WRONG_REQUEST'
      | 'NOT_OFFERED'
      | 'REJECTED'
      | 'FAILED',
    message: string,
  ) {
    super(message);
  }
}

/** How long the merchant is given to answer that it has something to sign. */
export const OFFLINE_OFFER_TIMEOUT_MS = 20_000;
/** How long it is given to submit and hear back from the chain. */
export const OFFLINE_RESULT_TIMEOUT_MS = 120_000;

export type OfflineCustomerInput = {
  payload: SignedPaymentIntentV1;
  /** The merchant on the other end of this link. */
  peerId: string;
  onStage?(stage: OfflineCustomerStage): void;
  /** Injectable so the sequence can be tested without a radio. */
  channel?: OfflineChannel;
  offerTimeoutMs?: number;
  resultTimeoutMs?: number;
};

/**
 * Which account on this phone is paying, and how it will prove it.
 *
 * Both kinds can do this, because both hold their key on the phone. A contract
 * wallet signs a digest with the key in the enclave; an account restored from
 * twelve words signs the preimage with the key in the keychain — the same thing
 * a browser wallet extension does when it signs an authorization entry. Neither
 * needs a network, which is the only question that matters here.
 */
function payingAccount(): {address: string; kind: 'smart-wallet' | 'classic'} {
  const {smartWallet, wallet} = useAppStore.getState();
  if (smartWallet) return {address: smartWallet.contractId, kind: 'smart-wallet'};
  if (wallet) return {address: wallet.address, kind: 'classic'};
  throw new OfflineCustomerError(
    'NO_WALLET',
    'Set this phone up once with a connection before paying without one',
  );
}

/**
 * Runs the customer's half and returns the receipt the merchant reported.
 *
 * Which is a receipt for a payment this phone cannot check. That is the honest
 * position offline and the screen says so: the transaction hash is real and
 * checkable, and the moment this phone has signal it will read the same
 * settlement the merchant already saw.
 */
export async function payOfflineOverCounter(input: OfflineCustomerInput): Promise<LocalReceipt> {
  const {intent} = input.payload;
  const account = payingAccount();

  const channel = input.channel ?? openOfflineChannel(input.peerId);
  const customerAddress = account.address;

  try {
    // 1. Say who is paying. The invocation names the payer, so the merchant
    //    cannot build anything to sign until this arrives.
    input.onStage?.('claiming');
    await channel.send('payer', {
      v: 'RTP/1',
      intentId: intent.intentId,
      payer: customerAddress,
      account: account.kind,
    });

    // 2. Take back the one entry that needs a signature.
    input.onStage?.('authorizing');
    const offer = await channel
      .next('authRequest', input.offerTimeoutMs ?? OFFLINE_OFFER_TIMEOUT_MS)
      .catch(error => {
        if (error instanceof OfflineChannelError && error.code === 'TIMED_OUT') {
          throw new OfflineCustomerError('NOT_OFFERED', 'This merchant cannot take a payment without a network');
        }
        throw error;
      });
    if (offer.intentId !== intent.intentId) {
      throw new OfflineCustomerError('WRONG_REQUEST', 'The merchant answered about a different payment');
    }

    const request: UnsignedAuthRequest = {
      version: 'RTP/1',
      networkPassphrase: offer.networkPassphrase,
      settlementContractId: offer.settlementContractId,
      entryXdr: offer.entryXdr,
      signatureExpirationLedger: offer.signatureExpirationLedger,
    };

    // 3. Check it against the request on screen, then sign it. Everything here
    //    is local: no ledger is read, no simulation is run, nothing is fetched.
    input.onStage?.('signing');
    const reason = `Approve ${intent.amount} ${intent.asset.code} to ${intent.merchantName}`;
    // Asked for here rather than up front, so the device prompt arrives with
    // the exact payment behind it rather than while the merchant is still
    // working out what that payment is.
    const proof =
      account.kind === 'smart-wallet'
        ? {signer: createHardwareDigestSigner(useAppStore.getState().smartWallet!.devicePublicKey)}
        : {accountSigner: await createCustomerSigner(reason)};

    // Which account this phone tried to sign with, said out loud. Without it a
    // phone that produced no key reports only that there was none, and the two
    // kinds fail for completely different reasons — an enclave key that was
    // never minted, or a recovery phrase whose key is not in the keychain.
    if (!('signer' in proof ? proof.signer : proof.accountSigner)) {
      throw new OfflineCustomerError(
        'NO_WALLET',
        `This phone holds no usable key for its ${
          account.kind === 'smart-wallet' ? 'device wallet' : 'recovery-phrase account'
        }`,
      );
    }

    const authorization = await authorizeOffline({
      request,
      intent,
      customerAddress,
      ...proof,
      reason,
      latestLedger: offer.latestLedger,
    });

    await channel.send('authorization', {
      v: 'RTP/1',
      intentId: intent.intentId,
      authorizer: authorization.authorizer,
      signatureExpirationLedger: authorization.signatureExpirationLedger,
      entryXdr: authorization.entryXdr,
    });

    // 4. Wait to be told what the chain said. This phone cannot look.
    input.onStage?.('submitting');
    const result = await channel.next('result', input.resultTimeoutMs ?? OFFLINE_RESULT_TIMEOUT_MS);
    if (result.intentId !== intent.intentId) {
      throw new OfflineCustomerError('WRONG_REQUEST', 'The merchant reported a different payment');
    }
    if (result.status !== 'confirmed' || !result.transactionHash) {
      throw new OfflineCustomerError('FAILED', result.message ?? 'The merchant could not settle this payment');
    }

    input.onStage?.('confirmed');
    logger.info('offline_payment_settled', {
      intentId: intent.intentId,
      transactionHash: result.transactionHash,
    });

    return {
      intentId: intent.intentId,
      merchantName: intent.merchantName,
      recipient: intent.recipient,
      amount: intent.amount,
      assetCode: intent.asset.code,
      network: intent.network,
      payloadHash: hashPaymentIntent(intent),
      status: 'confirmed',
      transactionHash: result.transactionHash,
      createdAt: new Date().toISOString(),
      ...(result.ledger === undefined ? {} : {ledger: result.ledger}),
      confirmedAt: new Date().toISOString(),
      transport: 'ble',
    };
  } catch (error) {
    // Say so rather than going quiet: the merchant is standing there with a
    // screen that would otherwise wait out its whole budget.
    await channel
      .send('decline', {
        v: 'RTP/1',
        intentId: intent.intentId,
        reason: error instanceof Error ? error.message.slice(0, 400) : 'This payment stopped',
      })
      .catch(() => undefined);
    throw error;
  } finally {
    // Closed, not released. Retry is a button on the screen that called this,
    // and letting the link go here would leave it with nothing to press
    // against — the screen releases the merchant when it goes away.
    if (!input.channel) channel.close();
  }
}
