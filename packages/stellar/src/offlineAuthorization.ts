import {Address, hash, scValToNative, xdr} from '@stellar/stellar-sdk';
import {Buffer} from 'buffer';
import {buildSettlementEnvelope, type SettlementEnvelopeContext} from './settlementEnvelope';
import {signWalletAuthPayload, type HardwareDigestSigner} from './walletAuth';

/**
 * Everything a customer needs to authorize a payment without a network.
 *
 * The merchant is the side that is online, so it does the simulation and hands
 * over the exact invocation. The customer only needs to check it and sign, which
 * is what lets a phone in airplane mode take part in a Stellar payment.
 */
export type UnsignedAuthRequest = {
  version: 'RTP/1';
  networkPassphrase: string;
  settlementContractId: string;
  /** Base64 XDR of the customer's unsigned `SorobanAuthorizationEntry`. */
  entryXdr: string;
  /** Ledger after which this authorization is worthless. */
  signatureExpirationLedger: number;
};

/** The customer's answer: the same entry, signed by the device. */
export type PaymentAuthorization = {
  version: 'RTP/1';
  authorizer: string;
  signatureExpirationLedger: number;
  entryXdr: string;
};

export type OfflineAuthorizationErrorCode =
  | 'MALFORMED_REQUEST'
  | 'WRONG_CONTRACT'
  | 'WRONG_FUNCTION'
  | 'WRONG_AUTHORIZER'
  | 'INTENT_MISMATCH'
  | 'EXPIRED_AUTHORIZATION';

export class OfflineAuthorizationError extends Error {
  override readonly name = 'OfflineAuthorizationError';
  constructor(readonly code: OfflineAuthorizationErrorCode, message: string) {
    super(message);
  }
}

const SETTLE_FUNCTION = 'settle_payment';

function parseEntry(request: UnsignedAuthRequest): xdr.SorobanAuthorizationEntry {
  try {
    return xdr.SorobanAuthorizationEntry.fromXDR(request.entryXdr, 'base64');
  } catch {
    throw new OfflineAuthorizationError('MALFORMED_REQUEST', 'The authorization request could not be read');
  }
}

function contractInvocation(entry: xdr.SorobanAuthorizationEntry) {
  const invocation = entry.rootInvocation().function();
  if (invocation.switch() !== xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn()) {
    throw new OfflineAuthorizationError('WRONG_FUNCTION', 'This authorization is not a contract call');
  }
  return invocation.contractFn();
}

/**
 * Checks that the invocation the customer is about to sign is the payment shown
 * on screen, and nothing else.
 *
 * This is the whole security of an offline signature. The customer cannot ask
 * the network what it is signing, so the request is rebuilt locally from the
 * merchant-signed intent and compared field by field. A merchant that swapped
 * the amount, the recipient or the payer produces an invocation that no longer
 * matches the intent it signed, and the customer never sees an approval screen.
 */
export function assertAuthorizationMatchesIntent(
  request: UnsignedAuthRequest,
  intent: unknown,
  context: {customerAddress: string; latestLedger?: number},
): void {
  const entry = parseEntry(request);
  const call = contractInvocation(entry);

  const contractId = Address.fromScAddress(call.contractAddress()).toString();
  if (contractId !== request.settlementContractId) {
    throw new OfflineAuthorizationError('WRONG_CONTRACT', 'This authorization names another settlement contract');
  }
  if (call.functionName().toString() !== SETTLE_FUNCTION) {
    throw new OfflineAuthorizationError('WRONG_FUNCTION', 'This authorization is not a settlement');
  }

  const credentials = entry.credentials();
  if (credentials.switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
    throw new OfflineAuthorizationError('WRONG_AUTHORIZER', 'This authorization is not addressed to an account');
  }
  const authorizer = Address.fromScAddress(credentials.address().address()).toString();
  if (authorizer !== context.customerAddress) {
    throw new OfflineAuthorizationError('WRONG_AUTHORIZER', 'This authorization asks someone else to pay');
  }

  if (context.latestLedger !== undefined && request.signatureExpirationLedger <= context.latestLedger) {
    throw new OfflineAuthorizationError('EXPIRED_AUTHORIZATION', 'This payment request has already expired');
  }

  const envelopeContext: SettlementEnvelopeContext = {
    customer: context.customerAddress,
    networkPassphrase: request.networkPassphrase,
    settlementContractId: request.settlementContractId,
  };
  const expected = buildSettlementEnvelope(intent, envelopeContext).intent;

  const args = call.args();
  if (args.length === 0) {
    throw new OfflineAuthorizationError('INTENT_MISMATCH', 'This authorization carries no payment');
  }
  const actual = scValToNative(args[0]!) as Record<string, unknown>;

  const mismatch = firstMismatch(expected as unknown as Record<string, unknown>, actual);
  if (mismatch) {
    throw new OfflineAuthorizationError(
      'INTENT_MISMATCH',
      `This authorization does not match the payment shown: ${mismatch} differs`,
    );
  }
}

/** The first field whose value differs, so the message can name it. */
function firstMismatch(expected: Record<string, unknown>, actual: Record<string, unknown>): string | null {
  for (const key of Object.keys(expected)) {
    if (!same(expected[key], actual[key])) return key;
  }
  return null;
}

function same(expected: unknown, actual: unknown): boolean {
  if (expected instanceof Uint8Array || Buffer.isBuffer(expected)) {
    const left = Buffer.from(expected as Uint8Array);
    const right = actual instanceof Uint8Array || Buffer.isBuffer(actual) ? Buffer.from(actual as Uint8Array) : null;
    return right !== null && left.equals(right);
  }
  if (typeof expected === 'bigint' || typeof actual === 'bigint') {
    try {
      return BigInt(expected as never) === BigInt(actual as never);
    } catch {
      return false;
    }
  }
  return expected === actual;
}

export type OfflineAuthorizationInput = {
  request: UnsignedAuthRequest;
  /** The merchant-signed RTP/1 intent the customer is looking at. */
  intent: unknown;
  customerAddress: string;
  signer: HardwareDigestSigner;
  reason?: string;
  /** When known, refuses a request the ledger has already passed. */
  latestLedger?: number;
};

/**
 * Signs a payment on a device with no network.
 *
 * Everything here is local: the invocation is checked against the intent, the
 * authorization preimage is built from the network id, the nonce and the
 * expiry the merchant supplied, and the device signs its hash. Nothing is
 * fetched, so a phone in airplane mode produces an authorization a merchant can
 * submit later.
 */
export async function authorizeOffline(input: OfflineAuthorizationInput): Promise<PaymentAuthorization> {
  assertAuthorizationMatchesIntent(input.request, input.intent, {
    customerAddress: input.customerAddress,
    ...(input.latestLedger === undefined ? {} : {latestLedger: input.latestLedger}),
  });

  const entry = parseEntry(input.request);
  const credentials = entry.credentials().address();
  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(input.request.networkPassphrase, 'utf8')),
      nonce: credentials.nonce(),
      signatureExpirationLedger: input.request.signatureExpirationLedger,
      invocation: entry.rootInvocation(),
    }),
  );
  const payload = hash(preimage.toXDR());

  const signature = await signWalletAuthPayload(
    input.signer,
    Buffer.from(payload),
    input.reason ?? 'Approve this payment',
  );

  credentials.signatureExpirationLedger(input.request.signatureExpirationLedger);
  credentials.signature(signature);

  return {
    version: 'RTP/1',
    authorizer: input.customerAddress,
    signatureExpirationLedger: input.request.signatureExpirationLedger,
    entryXdr: entry.toXDR('base64'),
  };
}

export type AuthorizationRequestSource = {
  /** A simulated `settle_payment` that still needs the customer's signature. */
  needsNonInvokerSigningBy(): string[];
  toXDR(): string;
};

export type PrepareAuthorizationRequestInput = {
  transaction: AuthorizationRequestSource;
  customerAddress: string;
  networkPassphrase: string;
  settlementContractId: string;
  signatureExpirationLedger: number;
};

/**
 * Extracts the one thing a customer has to sign, so it can travel over a tap or
 * a code instead of over the network.
 *
 * The merchant runs this because the merchant is the side with a connection:
 * simulating the call is what produces the invocation, the nonce and the
 * footprint. What crosses to the customer is only the authorization entry.
 */
export function prepareAuthorizationRequest(input: PrepareAuthorizationRequestInput): UnsignedAuthRequest {
  const pending = input.transaction.needsNonInvokerSigningBy();
  if (!pending.includes(input.customerAddress)) {
    throw new OfflineAuthorizationError(
      'WRONG_AUTHORIZER',
      'This settlement does not ask the named customer to authorize it',
    );
  }

  const envelope = xdr.TransactionEnvelope.fromXDR(input.transaction.toXDR(), 'base64');
  const operations =
    envelope.switch() === xdr.EnvelopeType.envelopeTypeTx()
      ? envelope.v1().tx().operations()
      : [];
  const invokeHostFunction = operations
    .map(operation => operation.body())
    .find(body => body.switch() === xdr.OperationType.invokeHostFunction());
  if (!invokeHostFunction) {
    throw new OfflineAuthorizationError('MALFORMED_REQUEST', 'This settlement has no contract call to authorize');
  }

  const entry = invokeHostFunction
    .invokeHostFunctionOp()
    .auth()
    .find(candidate => {
      if (candidate.credentials().switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) return false;
      return (
        Address.fromScAddress(candidate.credentials().address().address()).toString() === input.customerAddress
      );
    });
  if (!entry) {
    throw new OfflineAuthorizationError('WRONG_AUTHORIZER', 'This settlement carries no entry for that customer');
  }

  return {
    version: 'RTP/1',
    networkPassphrase: input.networkPassphrase,
    settlementContractId: input.settlementContractId,
    entryXdr: entry.toXDR('base64'),
    signatureExpirationLedger: input.signatureExpirationLedger,
  };
}
