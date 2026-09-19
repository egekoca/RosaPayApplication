import {WebAuth} from '@stellar/stellar-sdk';
import type {AnchorInfo} from './stellarToml';

/**
 * SEP-10, the handshake that proves to an anchor that a customer controls their
 * Stellar account. The anchor sends a transaction to sign; a valid signature
 * earns a session token.
 *
 * The challenge is the dangerous part. It is a real Stellar transaction handed
 * over by a third party, so it is verified before the customer's key goes
 * anywhere near it: the sequence number must be zero so it can never reach the
 * ledger, it must be signed by the key the anchor published in its stellar.toml,
 * and it must name this customer, this anchor and this network.
 */
export type WebAuthErrorCode =
  | 'AUTH_UNSUPPORTED'
  | 'CHALLENGE_UNAVAILABLE'
  | 'CHALLENGE_REJECTED'
  | 'TOKEN_REFUSED';

export class WebAuthError extends Error {
  override readonly name = 'WebAuthError';
  constructor(readonly code: WebAuthErrorCode, message: string) {
    super(message);
  }
}

export type ChallengeSigner = {
  /** The classic account being authenticated. */
  accountId: string;
  /** Signs the challenge XDR and returns the signed XDR. */
  signTransaction(xdr: string, options: {networkPassphrase: string}): Promise<string>;
};

export type SessionToken = {
  token: string;
  /** The account the token speaks for. */
  account: string;
  homeDomain: string;
  authProtocol: 'SEP-10' | 'SEP-45';
};

export type WebAuthOptions = {
  fetcher?: typeof fetch;
  /** Sent when the anchor issues per-client tokens; optional. */
  clientDomain?: string;
  memo?: string;
};

export async function authenticate(
  anchor: AnchorInfo,
  signer: ChallengeSigner,
  {fetcher = fetch, clientDomain, memo}: WebAuthOptions = {},
): Promise<SessionToken> {
  if (!anchor.webAuthEndpoint) {
    throw new WebAuthError(
      'AUTH_UNSUPPORTED',
      `${anchor.homeDomain} does not offer SEP-10 authentication`,
    );
  }

  const challengeUrl = new URL(anchor.webAuthEndpoint);
  challengeUrl.searchParams.set('account', signer.accountId);
  challengeUrl.searchParams.set('home_domain', anchor.homeDomain);
  if (clientDomain) challengeUrl.searchParams.set('client_domain', clientDomain);
  if (memo) challengeUrl.searchParams.set('memo', memo);

  let challenge: {transaction?: string; network_passphrase?: string};
  try {
    const response = await fetcher(challengeUrl.toString());
    challenge = (await response.json()) as typeof challenge;
    if (!response.ok || !challenge.transaction) {
      throw new WebAuthError('CHALLENGE_UNAVAILABLE', `${anchor.homeDomain} would not start a session`);
    }
  } catch (error) {
    if (error instanceof WebAuthError) throw error;
    throw new WebAuthError('CHALLENGE_UNAVAILABLE', `${anchor.homeDomain} could not be reached`);
  }

  if (challenge.network_passphrase && challenge.network_passphrase !== anchor.networkPassphrase) {
    throw new WebAuthError(
      'CHALLENGE_REJECTED',
      'The anchor answered for a different Stellar network than it advertises',
    );
  }

  // The official reader enforces the SEP-10 invariants: sequence 0, the anchor's
  // own signature, the right home domain and the right client account.
  try {
    const read = WebAuth.readChallengeTx(
      challenge.transaction!,
      anchor.signingKey,
      anchor.networkPassphrase,
      anchor.homeDomain,
      new URL(anchor.webAuthEndpoint).host,
    );
    if (read.clientAccountID !== signer.accountId) {
      throw new WebAuthError('CHALLENGE_REJECTED', 'The anchor asked a different account to authenticate');
    }
  } catch (error) {
    if (error instanceof WebAuthError) throw error;
    throw new WebAuthError(
      'CHALLENGE_REJECTED',
      `The challenge from ${anchor.homeDomain} is not a valid SEP-10 challenge`,
    );
  }

  const signed = await signer.signTransaction(challenge.transaction!, {
    networkPassphrase: anchor.networkPassphrase,
  });

  let token: {token?: string; error?: string};
  try {
    const response = await fetcher(anchor.webAuthEndpoint, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({transaction: signed}),
    });
    token = (await response.json()) as typeof token;
    if (!response.ok || !token.token) {
      throw new WebAuthError('TOKEN_REFUSED', token.error ?? `${anchor.homeDomain} refused the signed challenge`);
    }
  } catch (error) {
    if (error instanceof WebAuthError) throw error;
    throw new WebAuthError('TOKEN_REFUSED', `${anchor.homeDomain} could not be reached`);
  }

  return {
    token: token.token!,
    account: signer.accountId,
    homeDomain: anchor.homeDomain,
    authProtocol: 'SEP-10',
  };
}
