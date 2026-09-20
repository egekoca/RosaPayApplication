import {Address, authorizeEntry, hash, scValToNative, xdr} from '@stellar/stellar-sdk';
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
  const actual = readIntentArgument(args[0]!);

  const mismatch = firstMismatch(expected as unknown as Record<string, unknown>, actual);
  if (mismatch) {
    throw new OfflineAuthorizationError(
      'INTENT_MISMATCH',
      `This authorization does not match the payment shown: ${mismatch.field} differs` +
        ` (this phone read ${mismatch.expected}, the merchant sent ${mismatch.actual})`,
    );
  }
}

/**
 * Reads the payment out of the invocation without asking the runtime for help
 * with the field names.
 *
 * `scValToNative` would do this in one call, and it did — but a contract struct
 * is a map keyed by symbols, and once the value has crossed a wire those
 * symbols are bytes rather than strings, so the SDK reaches for `TextDecoder`
 * to read them. React Native ships none. The SDK's own fallback is a `catch`
 * that returns the raw bytes, so every field name decoded to a comma-separated
 * list of character codes, every lookup by name found nothing, and a customer
 * was told the merchant had changed the amount on a payment both phones were
 * showing identically.
 *
 * It was invisible in tests because a value built in memory keeps its symbols
 * as strings and never takes that path; only one that has been through XDR
 * does, which is every value a phone ever sees.
 *
 * So anything textual — a field name, and a value that was written as text — is
 * read here from the bytes, with no global involved. Everything else is left to
 * `scValToNative`, which needs no decoder for an address, an integer or a byte
 * array.
 */
function readIntentArgument(value: xdr.ScVal): Record<string, unknown> {
  if (value.switch() !== xdr.ScValType.scvMap()) return {};
  const decoded: Record<string, unknown> = {};
  for (const entry of value.map() ?? []) {
    const key = readText(entry.key());
    if (key === null) continue;
    const field = entry.val();
    // A value written as text has the same problem its name does.
    decoded[key] = readText(field) ?? scValToNative(field);
  }
  return decoded;
}

/**
 * The text in an `ScVal`, or nothing when it holds something that is not text.
 *
 * A contract struct keys its map with symbols; a map built in JavaScript from a
 * plain object keys it with strings. Both are text, both arrive as bytes once
 * they have been through XDR, and both are read the same way here rather than
 * one of them quietly reading as nothing at all.
 */
function readText(value: xdr.ScVal): string | null {
  const kind = value.switch();
  const raw =
    kind === xdr.ScValType.scvSymbol()
      ? (value.sym() as unknown)
      : kind === xdr.ScValType.scvString()
        ? (value.str() as unknown)
        : null;
  if (raw === null) return null;
  if (typeof raw === 'string') return raw;
  if (raw instanceof Uint8Array || Buffer.isBuffer(raw)) {
    return Buffer.from(raw as Uint8Array).toString('utf8');
  }
  return null;
}

export type IntentFieldMismatch = {field: string; expected: string; actual: string};

/**
 * The first field whose value differs, and what the two sides had.
 *
 * Naming the field alone was not enough to act on. A customer holding a phone
 * has no console, and "amount differs" is the same sentence whether a merchant
 * really changed the price, or the two sides encoded the same price two ways,
 * or the field arrived missing entirely — three completely different faults,
 * only one of which is the merchant's. The values are already on both screens
 * in some form, so putting them in the message gives away nothing and is the
 * only way the sentence becomes evidence.
 */
function firstMismatch(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): IntentFieldMismatch | null {
  for (const key of Object.keys(expected)) {
    if (!same(expected[key], actual[key])) {
      return {field: key, expected: describeValue(expected[key]), actual: describeValue(actual[key])};
    }
  }
  return null;
}

/** Short enough to sit in one sentence, exact enough to compare by eye. */
function describeValue(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return `${Buffer.from(value as Uint8Array).toString('hex').slice(0, 12)}…`;
  }
  const text = String(value);
  return text.length > 24 ? `${text.slice(0, 10)}…${text.slice(-6)}` : text;
}

function same(expected: unknown, actual: unknown): boolean {
  if (expected instanceof Uint8Array || Buffer.isBuffer(expected)) {
    const left = Buffer.from(expected as Uint8Array);
    const right = actual instanceof Uint8Array || Buffer.isBuffer(actual) ? Buffer.from(actual as Uint8Array) : null;
    return right !== null && left.equals(right);
  }
  // Two bigints are compared as they are. This used to convert both through
  // `BigInt()` first — a conversion a runtime is free to refuse on a value that
  // is already a bigint — inside a `catch` that turned any refusal into "these
  // differ". A phone then reported the merchant as having changed the amount
  // when the two amounts were identical and only the comparison had failed.
  if (typeof expected === 'bigint' && typeof actual === 'bigint') return expected === actual;
  if (typeof expected === 'bigint' || typeof actual === 'bigint') {
    const left = asBigInt(expected);
    const right = asBigInt(actual);
    return left !== null && right !== null && left === right;
  }
  return expected === actual;
}

/** A whole number written any of the ways a decoder might hand one over. */
function asBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : null;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

/**
 * A classic Stellar account signing for itself.
 *
 * Exactly the shape a wallet extension exposes, and for the same reason: an
 * account with its own Ed25519 key signs the hash of the authorization preimage
 * and nothing else. Every part of that is local, which is what makes an account
 * held as twelve words as able to pay offline as the contract wallet this app
 * creates — the key is on the phone either way.
 */
export type OfflineAccountSigner = {
  signAuthEntry(
    preimageXdr: string,
    options?: {address?: string; networkPassphrase?: string},
  ): Promise<{signedAuthEntry: string}>;
};

export type OfflineAuthorizationInput = {
  request: UnsignedAuthRequest;
  /** The merchant-signed RTP/1 intent the customer is looking at. */
  intent: unknown;
  customerAddress: string;
  /**
   * How this phone proves the payment, and there are two because there are two
   * kinds of account. A contract wallet authorizes the whole entry with its
   * device key; a classic account signs the preimage the way any Stellar key
   * does. Exactly one is required, and neither reaches the network.
   */
  signer?: HardwareDigestSigner;
  accountSigner?: OfflineAccountSigner;
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

  /*
   * A classic account signs the preimage, so the SDK's own helper does it:
   * it sets the expiry, builds the preimage, asks for a signature over its
   * hash, checks that signature against the address the entry names, and wraps
   * it the way the host expects. All of that is arithmetic on bytes already in
   * hand — nothing is fetched, which is the only property that matters here.
   */
  if (input.accountSigner) {
    const signed = await authorizeEntry(
      entry,
      async (preimage: xdr.HashIdPreimage) => {
        const {signedAuthEntry} = await input.accountSigner!.signAuthEntry(preimage.toXDR('base64'), {
          address: input.customerAddress,
          networkPassphrase: input.request.networkPassphrase,
        });
        return Buffer.from(signedAuthEntry, 'base64');
      },
      input.request.signatureExpirationLedger,
      input.request.networkPassphrase,
    );
    return {
      version: 'RTP/1',
      authorizer: input.customerAddress,
      signatureExpirationLedger: input.request.signatureExpirationLedger,
      entryXdr: signed.toXDR('base64'),
    };
  }

  if (!input.signer) {
    throw new OfflineAuthorizationError(
      'MALFORMED_REQUEST',
      'This payment has no key on this phone to sign it with',
    );
  }

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
