import {
  Address,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  buildAuthorizationEntryPreimage,
  checkAuthEntryReadiness,
  hash,
  inspectAuthEntry,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import {Buffer} from 'buffer';
import type {AnchorInfo} from './stellarToml';
import type {SessionToken} from './webAuth';

export type ContractWebAuthErrorCode =
  | 'AUTH_UNSUPPORTED'
  | 'CHALLENGE_UNAVAILABLE'
  | 'CHALLENGE_REJECTED'
  | 'SIMULATION_REJECTED'
  | 'TOKEN_REFUSED';

export class ContractWebAuthError extends Error {
  override readonly name = 'ContractWebAuthError';
  constructor(readonly code: ContractWebAuthErrorCode, message: string) {
    super(message);
  }
}

export type ContractChallengeSigner = {
  /** The C-address being authenticated. */
  accountId: string;
  /** A funded G-address used only as the source of the free simulation. */
  transactionSourceAccount: string;
  /** Signs only the already-validated client authorization entry. */
  authorizeEntry(
    entry: xdr.SorobanAuthorizationEntry,
    validUntilLedger: number,
    networkPassphrase: string,
  ): Promise<xdr.SorobanAuthorizationEntry>;
};

export type ContractWebAuthOptions = {
  rpcUrl: string;
  fetcher?: typeof fetch;
  /** A short replay window, measured from the live ledger. */
  signatureExpirationLedgers?: number;
  /** Test/custom transport seam; normal callers should use rpcUrl. */
  rpcServer?: Pick<rpc.Server, 'getLatestLedger' | 'getAccount' | 'simulateTransaction'>;
};

type ChallengeArgs = Record<string, string>;

/**
 * SEP-45 authentication for Rosa Pay's contract account.
 *
 * Every entry is decoded and checked before the device signs. The signed set is
 * then simulated and its write footprint is constrained to the nonce entries
 * SEP-45 permits, so a challenge cannot smuggle another contract call into the
 * biometric prompt.
 */
export async function authenticateContract(
  anchor: AnchorInfo,
  signer: ContractChallengeSigner,
  {
    rpcUrl,
    fetcher = fetch,
    signatureExpirationLedgers = 60,
    rpcServer,
  }: ContractWebAuthOptions,
): Promise<SessionToken> {
  if (!anchor.webAuthForContractsEndpoint || !anchor.webAuthContractId) {
    throw new ContractWebAuthError(
      'AUTH_UNSUPPORTED',
      `${anchor.homeDomain} does not offer complete SEP-45 authentication`,
    );
  }
  assertAddress(signer.accountId, 'C', 'The SEP-45 account is not a contract address');
  assertAddress(signer.transactionSourceAccount, 'G', 'The SEP-45 simulation source is not a classic account');
  assertAddress(anchor.webAuthContractId, 'C', 'The anchor publishes no usable SEP-45 contract');
  if (!Number.isInteger(signatureExpirationLedgers) || signatureExpirationLedgers < 1) {
    throw new RangeError('SEP-45 signature expiration must be a positive ledger count');
  }

  const endpoint = new URL(anchor.webAuthForContractsEndpoint);
  endpoint.searchParams.set('account', signer.accountId);
  endpoint.searchParams.set('home_domain', anchor.homeDomain);

  let challenge: {authorization_entries?: string; authorizationEntries?: string; network_passphrase?: string; networkPassphrase?: string};
  try {
    const response = await fetcher(endpoint.toString());
    challenge = (await response.json()) as typeof challenge;
    if (!response.ok) {
      throw new ContractWebAuthError('CHALLENGE_UNAVAILABLE', `${anchor.homeDomain} would not start a SEP-45 session`);
    }
  } catch (error) {
    if (error instanceof ContractWebAuthError) throw error;
    throw new ContractWebAuthError('CHALLENGE_UNAVAILABLE', `${anchor.homeDomain} could not be reached`);
  }

  const encodedEntries = challenge.authorization_entries ?? challenge.authorizationEntries;
  const networkPassphrase = challenge.network_passphrase ?? challenge.networkPassphrase;
  if (!encodedEntries || !networkPassphrase) {
    throw new ContractWebAuthError('CHALLENGE_REJECTED', `${anchor.homeDomain} returned an incomplete SEP-45 challenge`);
  }
  if (networkPassphrase !== anchor.networkPassphrase) {
    throw new ContractWebAuthError('CHALLENGE_REJECTED', 'The SEP-45 challenge is for another Stellar network');
  }

  let entries: xdr.SorobanAuthorizationEntry[];
  try {
    entries = xdr.SorobanAuthorizationEntries.fromXDR(encodedEntries, 'base64');
  } catch {
    throw new ContractWebAuthError('CHALLENGE_REJECTED', 'The SEP-45 authorization entries are not valid XDR');
  }

  const expectedArgs: ChallengeArgs = {
    account: signer.accountId,
    home_domain: anchor.homeDomain,
    web_auth_domain: new URL(anchor.webAuthForContractsEndpoint).host,
    web_auth_domain_account: anchor.signingKey,
  };
  const {clientEntryIndex, invocationArgs, serverEntry} = validateChallengeEntries(
    entries,
    expectedArgs,
    anchor.webAuthContractId,
    anchor.signingKey,
    anchor.networkPassphrase,
  );

  const server = rpcServer ?? new rpc.Server(rpcUrl);
  let latestLedger: number;
  try {
    latestLedger = (await server.getLatestLedger()).sequence;
  } catch {
    throw new ContractWebAuthError('SIMULATION_REJECTED', 'Stellar RPC could not provide a ledger for SEP-45');
  }
  if (!checkAuthEntryReadiness(serverEntry, latestLedger).ready) {
    throw new ContractWebAuthError('CHALLENGE_REJECTED', 'The SEP-45 anchor signature is expired or incomplete');
  }
  if (latestLedger + signatureExpirationLedgers > 0xffffffff) {
    throw new ContractWebAuthError('SIMULATION_REJECTED', 'The SEP-45 signature expiration exceeds a ledger number');
  }
  const validUntilLedger = latestLedger + signatureExpirationLedgers;
  const originalClientEntry = entries[clientEntryIndex]!;
  const signedClientEntry = await signer.authorizeEntry(
    originalClientEntry,
    validUntilLedger,
    anchor.networkPassphrase,
  );
  validateSignedClientEntry(originalClientEntry, signedClientEntry, signer.accountId, validUntilLedger);
  const signedEntries = entries.map((entry, index) => index === clientEntryIndex ? signedClientEntry : entry);

  const operation = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(anchor.webAuthContractId).toScAddress(),
        functionName: 'web_auth_verify',
        args: invocationArgs,
      }),
    ),
    auth: signedEntries,
  });

  let simulation: Awaited<ReturnType<rpc.Server['simulateTransaction']>>;
  try {
    const source = await server.getAccount(signer.transactionSourceAccount);
    const transaction = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: anchor.networkPassphrase,
    }).addOperation(operation).setTimeout(300).build();
    simulation = await server.simulateTransaction(transaction);
  } catch {
    throw new ContractWebAuthError('SIMULATION_REJECTED', 'The SEP-45 challenge could not be simulated');
  }
  if (!rpc.Api.isSimulationSuccess(simulation)) {
    throw new ContractWebAuthError('SIMULATION_REJECTED', 'The signed SEP-45 challenge failed simulation');
  }
  validateSimulationFootprint(
    simulation.transactionData.getReadWrite(),
    new Set([signer.accountId, anchor.signingKey]),
    anchor.webAuthContractId,
  );

  const authorizationEntries = encodeAuthorizationEntries(signedEntries);
  let token: {token?: string; error?: string};
  try {
    const body = new URLSearchParams({authorization_entries: authorizationEntries});
    const response = await fetcher(anchor.webAuthForContractsEndpoint, {
      method: 'POST',
      headers: {'content-type': 'application/x-www-form-urlencoded'},
      body: body.toString(),
    });
    token = (await response.json()) as typeof token;
    if (!response.ok || !token.token) {
      throw new ContractWebAuthError(
        'TOKEN_REFUSED',
        token.error ?? `${anchor.homeDomain} refused the signed SEP-45 challenge`,
      );
    }
  } catch (error) {
    if (error instanceof ContractWebAuthError) throw error;
    throw new ContractWebAuthError('TOKEN_REFUSED', `${anchor.homeDomain} could not finish SEP-45 authentication`);
  }

  return {
    token: token.token!,
    account: signer.accountId,
    homeDomain: anchor.homeDomain,
    authProtocol: 'SEP-45',
  };
}

/**
 * Encodes the SEP-45 authorization-entry vector. The SDK exposes this typedef
 * as an XDR array reader, but js-xdr v4 cannot encode a typedef array through
 * its instance `toXDR` overload, so write its standard uint32 length prefix
 * followed by the already-aligned entry XDR values.
 */
export function encodeAuthorizationEntries(entries: xdr.SorobanAuthorizationEntry[]): string {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(entries.length);
  return Buffer.concat([length, ...entries.map(entry => entry.toXDR())]).toString('base64');
}

function validateChallengeEntries(
  entries: xdr.SorobanAuthorizationEntry[],
  expectedArgs: ChallengeArgs,
  webAuthContractId: string,
  serverSigningKey: string,
  networkPassphrase: string,
): {
  clientEntryIndex: number;
  invocationArgs: xdr.ScVal[];
  serverEntry: xdr.SorobanAuthorizationEntry;
} {
  if (entries.length !== 2) {
    throw new ContractWebAuthError('CHALLENGE_REJECTED', 'SEP-45 requires one client and one server entry');
  }

  let clientEntryIndex = -1;
  let serverEntry: xdr.SorobanAuthorizationEntry | undefined;
  let canonicalArgs: string | undefined;
  let invocationArgs: xdr.ScVal[] | undefined;

  entries.forEach((entry, index) => {
    const root = entry.rootInvocation();
    if (root.subInvocations().length !== 0) {
      throw new ContractWebAuthError('CHALLENGE_REJECTED', 'SEP-45 entries may not authorize sub-invocations');
    }
    if (
      root.function().switch().value !==
      xdr.SorobanAuthorizedFunctionType.sorobanAuthorizedFunctionTypeContractFn().value
    ) {
      throw new ContractWebAuthError('CHALLENGE_REJECTED', 'A SEP-45 entry is not a contract invocation');
    }
    const contractFunction = root.function().contractFn();
    if (Address.fromScAddress(contractFunction.contractAddress()).toString() !== webAuthContractId) {
      throw new ContractWebAuthError('CHALLENGE_REJECTED', 'A SEP-45 entry names another contract');
    }
    if (contractFunction.functionName().toString() !== 'web_auth_verify') {
      throw new ContractWebAuthError('CHALLENGE_REJECTED', 'A SEP-45 entry names another contract function');
    }
    const args = readArgs(contractFunction.args());
    for (const [key, value] of Object.entries(expectedArgs)) {
      if (args[key] !== value) {
        throw new ContractWebAuthError('CHALLENGE_REJECTED', `The SEP-45 challenge has the wrong ${key}`);
      }
    }
    const allowedKeys = new Set([...Object.keys(expectedArgs), 'nonce']);
    if (Object.keys(args).some(key => !allowedKeys.has(key)) || !args.nonce) {
      throw new ContractWebAuthError('CHALLENGE_REJECTED', 'The SEP-45 challenge contains unexpected arguments');
    }
    const serializedArgs = JSON.stringify(Object.entries(args).sort(([left], [right]) => left.localeCompare(right)));
    if (canonicalArgs !== undefined && canonicalArgs !== serializedArgs) {
      throw new ContractWebAuthError('CHALLENGE_REJECTED', 'The SEP-45 entries do not authorize the same arguments');
    }
    canonicalArgs = serializedArgs;
    invocationArgs = contractFunction.args();

    const info = inspectAuthEntry(entry);
    if (info.address === expectedArgs.account) {
      if (clientEntryIndex !== -1 || info.signed || info.credentialType !== 'address') {
        throw new ContractWebAuthError('CHALLENGE_REJECTED', 'The SEP-45 client entry is invalid');
      }
      clientEntryIndex = index;
    } else if (info.address === serverSigningKey) {
      if (serverEntry || info.credentialType !== 'address') {
        throw new ContractWebAuthError('CHALLENGE_REJECTED', 'The SEP-45 server entry is duplicated');
      }
      serverEntry = entry;
    } else {
      throw new ContractWebAuthError('CHALLENGE_REJECTED', 'A SEP-45 entry is for an unexpected address');
    }
  });

  if (clientEntryIndex === -1 || !serverEntry || !invocationArgs) {
    throw new ContractWebAuthError('CHALLENGE_REJECTED', 'The SEP-45 challenge is missing a required entry');
  }
  verifyServerEntry(serverEntry, serverSigningKey, networkPassphrase);
  return {clientEntryIndex, invocationArgs, serverEntry};
}

function validateSignedClientEntry(
  original: xdr.SorobanAuthorizationEntry,
  signed: xdr.SorobanAuthorizationEntry,
  account: string,
  validUntilLedger: number,
): void {
  const before = inspectAuthEntry(original);
  const after = inspectAuthEntry(signed);
  const sameInvocation = original.rootInvocation().toXDR().equals(signed.rootInvocation().toXDR());
  if (
    !sameInvocation ||
    after.credentialType !== 'address' ||
    after.address !== account ||
    after.nonce !== before.nonce ||
    after.signatureExpirationLedger !== validUntilLedger ||
    !after.signed ||
    after.signers.length !== 1 ||
    after.signers[0]!.address !== account
  ) {
    throw new ContractWebAuthError('CHALLENGE_REJECTED', 'The SEP-45 signer changed or did not sign the approved entry');
  }
}

function readArgs(values: xdr.ScVal[]): ChallengeArgs {
  if (values.length !== 1 || values[0]!.switch().value !== xdr.ScValType.scvMap().value) {
    throw new ContractWebAuthError('CHALLENGE_REJECTED', 'SEP-45 web_auth_verify must receive one argument map');
  }
  const result: ChallengeArgs = {};
  for (const entry of values[0]!.map() ?? []) {
    if (
      entry.key().switch().value !== xdr.ScValType.scvSymbol().value ||
      entry.val().switch().value !== xdr.ScValType.scvString().value
    ) {
      throw new ContractWebAuthError('CHALLENGE_REJECTED', 'SEP-45 arguments must be string values keyed by symbols');
    }
    result[entry.key().sym().toString()] = entry.val().str().toString();
  }
  return result;
}

function verifyServerEntry(entry: xdr.SorobanAuthorizationEntry, signingKey: string, networkPassphrase: string): void {
  const info = inspectAuthEntry(entry);
  const signatures = info.signers.flatMap(signer => signer.signatures ?? []);
  if (signatures.length !== 1 || signatures[0]!.publicKey !== signingKey || info.signatureExpirationLedger === null) {
    throw new ContractWebAuthError('CHALLENGE_REJECTED', 'The SEP-45 server entry has no valid anchor signature');
  }
  const preimage = buildAuthorizationEntryPreimage(entry, info.signatureExpirationLedger, networkPassphrase);
  const payload = hash(preimage.toXDR());
  if (!Keypair.fromPublicKey(signingKey).verify(payload, signatures[0]!.signature)) {
    throw new ContractWebAuthError('CHALLENGE_REJECTED', 'The SEP-45 challenge was not signed by the anchor');
  }
}

function validateSimulationFootprint(
  readWrite: xdr.LedgerKey[],
  nonceAddresses: Set<string>,
  webAuthContractId: string,
): void {
  for (const key of readWrite) {
    if (key.switch().value !== xdr.LedgerEntryType.contractData().value) {
      throw new ContractWebAuthError('SIMULATION_REJECTED', 'SEP-45 simulation would write a non-contract-data ledger entry');
    }
    const data = key.contractData();
    const address = Address.fromScAddress(data.contract()).toString();
    const valueType = data.key().switch().value;
    const nonce =
      nonceAddresses.has(address) && valueType === xdr.ScValType.scvLedgerKeyNonce().value;
    const restoredWebAuthInstance =
      address === webAuthContractId && valueType === xdr.ScValType.scvLedgerKeyContractInstance().value;
    if (!nonce && !restoredWebAuthInstance) {
      throw new ContractWebAuthError('SIMULATION_REJECTED', 'SEP-45 simulation would write unexpected contract data');
    }
  }
}

function assertAddress(value: string, prefix: 'C' | 'G', message: string): void {
  try {
    const parsed = Address.fromString(value);
    const expectedType = prefix === 'C' ? 'contract' : 'account';
    if (parsed.type === expectedType && value.startsWith(prefix)) return;
  } catch {
    // Converted to the stable, non-sensitive error below.
  }
  throw new ContractWebAuthError('CHALLENGE_REJECTED', message);
}
