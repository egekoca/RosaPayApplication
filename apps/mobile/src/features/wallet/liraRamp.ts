import {Asset, BASE_FEE, Memo, Operation, TransactionBuilder, rpc} from '@stellar/stellar-sdk';
import {authenticate, discoverAnchor, type AnchorInfo, type SessionToken} from '@rosapay/anchor';
import {createStellarConfig} from '@rosapay/stellar';
import {logger} from '../../shared/logger';
import {ensureTrustline} from './accountSetup';
import {loadSigningKey} from './keyVault';
import {keypairFromSecret} from './stellarKey';

/**
 * Buying USDC with Turkish lira, through the anchor's SEP-6 door.
 *
 * This is the standards door rather than the anchor's own partner API. The
 * partner API is better documented and takes a key, and a wallet that speaks it
 * is a wallet welded to one company; SEP-6 is what any anchor with a bank
 * behind it offers, so the same screens will work against a real Turkish anchor
 * when there is one.
 *
 * It needs a classic account. SEP-10 authenticates by having an account sign a
 * challenge transaction, and this anchor publishes no SEP-45, so a contract
 * account has no way to prove itself here at all — the smart wallet cannot use
 * this ramp, and that is a property of the anchor rather than something the app
 * can work around.
 */
export const LIRA_ANCHOR_HOME_DOMAIN = 'tr-mock-anchor.fly.dev';

export class LiraRampError extends Error {
  override readonly name = 'LiraRampError';

  constructor(
    readonly code: 'UNSUPPORTED_ACCOUNT' | 'ANCHOR_UNAVAILABLE' | 'TRUSTLINE_FAILED' | 'REFUSED',
    message: string,
  ) {
    super(message);
  }
}

/** What the customer has to do at their bank for the money to arrive. */
export type BankInstructions = {
  bankName?: string;
  iban?: string;
  /** Written in the transfer description; it is what routes the money. */
  reference?: string;
  minAmount?: number;
  maxAmount?: number;
  feePercent?: number;
  etaMinutes?: number;
};

export type StartedLiraDeposit = {
  transactionId: string;
  instructions: BankInstructions;
  session: SessionToken;
  transferServer: string;
  /** Sandbox only: stands in for the customer's bank actually sending the money. */
  simulateUrl: string;
};

export type LiraDepositStatus = {
  status: string;
  /** Terminal either way; a caller can stop polling. */
  settled: boolean;
  failed: boolean;
  amountIn?: string;
  amountOut?: string;
  stellarTransactionId?: string;
};

export type LiraQuote = {
  /** Lira per USDC, the direction a person reads. */
  perUsdc: string;
  /** What the customer receives, after the anchor's spread. */
  buyAmount: string;
  feeTotal?: string;
  feeAsset?: string;
};

async function discover(): Promise<AnchorInfo> {
  try {
    return await discoverAnchor(LIRA_ANCHOR_HOME_DOMAIN);
  } catch {
    throw new LiraRampError('ANCHOR_UNAVAILABLE', 'The lira anchor could not be reached right now.');
  }
}

async function readJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new LiraRampError('ANCHOR_UNAVAILABLE', 'The lira anchor could not be reached right now.');
  }
  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = undefined;
  }
  if (!response.ok) {
    const message =
      parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as {error: unknown}).error)
        : `The anchor answered ${response.status}`;
    throw new LiraRampError('REFUSED', message);
  }
  return (parsed ?? {}) as Record<string, unknown>;
}

/** What the customer would receive for an amount of lira, before they commit. */
export async function quoteLiraDeposit(amountTry: string): Promise<LiraQuote> {
  const anchor = await discover();
  const usdc = anchor.currencies.find(currency => currency.code === 'USDC');
  if (!anchor.quoteServer || !usdc?.issuer) {
    throw new LiraRampError('ANCHOR_UNAVAILABLE', 'The lira anchor is not quoting right now.');
  }

  const url = new URL(`${anchor.quoteServer}/price`);
  url.searchParams.set('sell_asset', 'iso4217:TRY');
  url.searchParams.set('buy_asset', `stellar:USDC:${usdc.issuer}`);
  url.searchParams.set('sell_amount', amountTry);
  url.searchParams.set('context', 'sep6');

  const quoted = await readJson(url.toString());
  const fee = quoted.fee as {total?: string; asset?: string} | undefined;
  return {
    // `total_price` includes the spread, which is what the customer actually
    // pays. Showing `price` would quote a rate they never get.
    perUsdc: String(quoted.total_price ?? quoted.price ?? '0'),
    buyAmount: String(quoted.buy_amount ?? '0'),
    ...(fee?.total ? {feeTotal: fee.total} : {}),
    ...(fee?.asset ? {feeAsset: fee.asset} : {}),
  };
}

/**
 * Opens a deposit and returns what the customer must do at their bank.
 *
 * The trustline is opened first and deliberately before the anchor is told
 * anything. Without one the USDC cannot arrive, and discovering that after the
 * lira has been sent leaves the customer's money with the anchor and nothing to
 * show for it.
 */
export async function startLiraDeposit(input: {
  address: string;
  amountTry: string;
  reason?: string;
}): Promise<StartedLiraDeposit> {
  const anchor = await discover();
  const usdc = anchor.currencies.find(currency => currency.code === 'USDC');
  const transferServer = anchor.transferServerSep6;
  if (!transferServer || !usdc?.issuer) {
    throw new LiraRampError('ANCHOR_UNAVAILABLE', 'The lira anchor is not accepting deposits right now.');
  }
  if (!anchor.webAuthEndpoint) {
    throw new LiraRampError('UNSUPPORTED_ACCOUNT', 'The lira anchor cannot verify this wallet.');
  }

  const keypair = keypairFromSecret(
    await loadSigningKey(input.reason ?? `Connect to ${anchor.homeDomain}`),
  );
  if (keypair.publicKey() !== input.address) {
    throw new LiraRampError(
      'UNSUPPORTED_ACCOUNT',
      'The key on this phone does not match the wallet it shows.',
    );
  }

  const config = createStellarConfig('testnet');
  try {
    await ensureTrustline(keypair, {code: 'USDC', issuer: usdc.issuer}, config);
  } catch (error) {
    throw new LiraRampError(
      'TRUSTLINE_FAILED',
      error instanceof Error ? error.message : 'This wallet could not open a line for USDC.',
    );
  }

  const session = await authenticate(anchor, {
    accountId: keypair.publicKey(),
    signTransaction: async (xdr, {networkPassphrase}) => {
      const challenge = TransactionBuilder.fromXDR(xdr, networkPassphrase);
      challenge.sign(keypair);
      return challenge.toXDR();
    },
  });

  const url = new URL(`${transferServer}/deposit-exchange`);
  url.searchParams.set('asset_code', 'USDC');
  url.searchParams.set('source_asset', 'iso4217:TRY');
  url.searchParams.set('destination_asset', `stellar:USDC:${usdc.issuer}`);
  url.searchParams.set('amount', input.amountTry);
  url.searchParams.set('account', keypair.publicKey());

  const opened = await readJson(url.toString(), {
    headers: {Authorization: `Bearer ${session.token}`},
  });
  const transactionId = String(opened.id ?? '');
  if (!transactionId) {
    throw new LiraRampError('REFUSED', 'The anchor opened no deposit for this wallet.');
  }

  logger.info('lira_deposit_opened', {transactionId, amountTry: input.amountTry});
  return {
    transactionId,
    instructions: readInstructions(opened),
    session,
    transferServer,
    simulateUrl: `${transferServer}/tx/${transactionId}/simulate-bank-transfer`,
  };
}

function readInstructions(opened: Record<string, unknown>): BankInstructions {
  const fields = (opened.instructions ?? {}) as Record<string, {value?: unknown}>;
  const value = (name: string) => {
    const field = fields[name]?.value;
    return typeof field === 'string' ? field : undefined;
  };
  const numeric = (name: string) => {
    const raw = opened[name];
    return typeof raw === 'number' ? raw : undefined;
  };
  return {
    ...(value('bank_name') ? {bankName: value('bank_name')!} : {}),
    ...(value('bank_account_number') ? {iban: value('bank_account_number')!} : {}),
    ...(value('external_transfer_memo') ? {reference: value('external_transfer_memo')!} : {}),
    ...(numeric('min_amount') === undefined ? {} : {minAmount: numeric('min_amount')!}),
    ...(numeric('max_amount') === undefined ? {} : {maxAmount: numeric('max_amount')!}),
    ...(numeric('fee_percent') === undefined ? {} : {feePercent: numeric('fee_percent')!}),
    ...(numeric('eta') === undefined ? {} : {etaMinutes: numeric('eta')!}),
  };
}

/** Where a transfer has got to, either direction. Terminal states stop polling. */
export async function readLiraTransfer(started: {
  transferServer: string;
  transactionId: string;
  session: SessionToken;
}): Promise<LiraDepositStatus> {
  const url = new URL(`${started.transferServer}/transaction`);
  url.searchParams.set('id', started.transactionId);
  const body = await readJson(url.toString(), {
    headers: {Authorization: `Bearer ${started.session.token}`},
  });
  const transaction = (body.transaction ?? body) as Record<string, unknown>;
  const status = String(transaction.status ?? 'unknown');
  return {
    status,
    settled: status === 'completed',
    failed: status === 'error' || status === 'refunded',
    ...(transaction.amount_in ? {amountIn: String(transaction.amount_in)} : {}),
    ...(transaction.amount_out ? {amountOut: String(transaction.amount_out)} : {}),
    ...(transaction.stellar_transaction_id
      ? {stellarTransactionId: String(transaction.stellar_transaction_id)}
      : {}),
  };
}

/**
 * Stands in for the customer's bank actually sending the money.
 *
 * Only a sandbox has this. It is kept out of the deposit flow proper and named
 * for what it is, so that the screen calling it reads as a demo affordance
 * rather than part of paying.
 */
export async function simulateBankTransfer(started: {
  simulateUrl: string;
  session: SessionToken;
}): Promise<void> {
  await readJson(started.simulateUrl, {
    method: 'POST',
    headers: {Authorization: `Bearer ${started.session.token}`},
  });
}

export type LiraWithdrawalQuote = {
  /** Lira per USDC, after the anchor's spread. */
  perUsdc: string;
  /** What reaches the bank account. */
  buyAmount: string;
  feeTotal?: string;
};

/** What an amount of USDC is worth in lira, before the customer commits. */
export async function quoteLiraWithdrawal(amountUsdc: string): Promise<LiraWithdrawalQuote> {
  const anchor = await discover();
  const usdc = anchor.currencies.find(currency => currency.code === 'USDC');
  if (!anchor.quoteServer || !usdc?.issuer) {
    throw new LiraRampError('ANCHOR_UNAVAILABLE', 'The lira anchor is not quoting right now.');
  }

  const url = new URL(`${anchor.quoteServer}/price`);
  url.searchParams.set('sell_asset', `stellar:USDC:${usdc.issuer}`);
  url.searchParams.set('buy_asset', 'iso4217:TRY');
  url.searchParams.set('sell_amount', amountUsdc);
  url.searchParams.set('context', 'sep6');

  const quoted = await readJson(url.toString());
  const fee = quoted.fee as {total?: string} | undefined;
  return {
    // Selling USDC to buy lira, SEP-38 quotes USDC per lira. A person reads the
    // other way round, so it is flipped here as it is everywhere else.
    perUsdc: String(1 / Number(quoted.total_price ?? quoted.price ?? 1)),
    buyAmount: String(quoted.buy_amount ?? '0'),
    ...(fee?.total ? {feeTotal: fee.total} : {}),
  };
}

export type StartedLiraWithdrawal = {
  transactionId: string;
  session: SessionToken;
  transferServer: string;
  /** Where the USDC must go, and the memo that says whose withdrawal it settles. */
  treasury: string;
  memo?: string;
  amountUsdc: string;
  bankAccount?: string;
};

/**
 * Opens a withdrawal and sends the USDC that funds it.
 *
 * Both halves are here on purpose. The anchor names an account and a memo, and
 * a payment that reaches that account without the memo is money sent to a
 * stranger — it settles nobody's withdrawal and there is no thread back to the
 * person who sent it. Leaving the two steps for a screen to sequence would make
 * that gap something a rushed edit could open.
 */
export async function startLiraWithdrawal(input: {
  address: string;
  amountUsdc: string;
  reason?: string;
}): Promise<StartedLiraWithdrawal> {
  const anchor = await discover();
  const usdc = anchor.currencies.find(currency => currency.code === 'USDC');
  const transferServer = anchor.transferServerSep6;
  if (!transferServer || !usdc?.issuer || !anchor.webAuthEndpoint) {
    throw new LiraRampError('ANCHOR_UNAVAILABLE', 'The lira anchor is not paying out right now.');
  }

  const keypair = keypairFromSecret(
    await loadSigningKey(input.reason ?? `Cash out ${input.amountUsdc} USDC`),
  );
  if (keypair.publicKey() !== input.address) {
    throw new LiraRampError(
      'UNSUPPORTED_ACCOUNT',
      'The key on this phone does not match the wallet it shows.',
    );
  }

  const session = await authenticate(anchor, {
    accountId: keypair.publicKey(),
    signTransaction: async (xdr, {networkPassphrase}) => {
      const challenge = TransactionBuilder.fromXDR(xdr, networkPassphrase);
      challenge.sign(keypair);
      return challenge.toXDR();
    },
  });

  const url = new URL(`${transferServer}/withdraw-exchange`);
  url.searchParams.set('asset_code', 'USDC');
  url.searchParams.set('source_asset', `stellar:USDC:${usdc.issuer}`);
  url.searchParams.set('destination_asset', 'iso4217:TRY');
  url.searchParams.set('amount', input.amountUsdc);

  const opened = await readJson(url.toString(), {
    headers: {Authorization: `Bearer ${session.token}`},
  });
  const treasury = String(opened.account_id ?? '');
  const transactionId = String(opened.id ?? '');
  if (!treasury || !transactionId) {
    throw new LiraRampError('REFUSED', 'The anchor opened no withdrawal for this wallet.');
  }
  const memo = opened.memo === undefined || opened.memo === null ? undefined : String(opened.memo);

  const config = createStellarConfig('testnet');
  const server = new rpc.Server(config.rpcUrl);
  const account = await server.getAccount(keypair.publicKey());
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: treasury,
        asset: new Asset('USDC', usdc.issuer),
        amount: input.amountUsdc,
      }),
    )
    .setTimeout(60);
  if (memo) builder.addMemo(Memo.id(memo));
  const payment = builder.build();
  payment.sign(keypair);

  let sent;
  try {
    sent = await server.sendTransaction(payment);
  } catch {
    throw new LiraRampError('REFUSED', 'The payment to the anchor could not be sent.');
  }
  if (sent.status === 'ERROR') {
    throw new LiraRampError('REFUSED', 'The network rejected the payment to the anchor.');
  }

  // Waited on rather than assumed: telling someone their lira is on the way
  // while the payment is still unconfirmed is the false success this project
  // refuses everywhere else.
  let settled = false;
  for (let attempt = 0; attempt < 20 && !settled; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    const result = await server.getTransaction(sent.hash).catch(() => undefined);
    if (result?.status === 'SUCCESS') settled = true;
    if (result?.status === 'FAILED') break;
  }
  if (!settled) {
    throw new LiraRampError('REFUSED', 'The payment to the anchor was not confirmed on Stellar.');
  }

  logger.info('lira_withdrawal_paid', {transactionId, amountUsdc: input.amountUsdc});
  return {
    transactionId,
    session,
    transferServer,
    treasury,
    amountUsdc: input.amountUsdc,
    ...(memo ? {memo} : {}),
    ...(typeof opened.extra_info === 'object' && opened.extra_info
      ? readBankAccount(opened.extra_info as Record<string, unknown>)
      : {}),
  };
}

/** The IBAN the anchor says it will pay, when it says one. */
function readBankAccount(extra: Record<string, unknown>): {bankAccount?: string} {
  const message = typeof extra.message === 'string' ? extra.message : '';
  const iban = /TR\d{24}/.exec(message)?.[0];
  return iban ? {bankAccount: iban} : {};
}
