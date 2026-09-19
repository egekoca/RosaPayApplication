import {Asset, BASE_FEE, Keypair, Memo, Operation, TransactionBuilder, rpc} from '@stellar/stellar-sdk';
import {authenticate, discoverAnchor, type AnchorInfo, type SessionToken} from '@rosapay/anchor';
import {createStellarConfig} from '@rosapay/stellar';
import {logger} from '../../shared/logger';
import {ensureTrustline} from './accountSetup';
import {loadSigningKey} from './keyVault';
import {keypairFromSecret} from './stellarKey';
import {ensureBridgeAccount} from './bridgeAccount';
import {
  fundBridgeAccount,
  sweepToSmartWallet,
  type AnchorBridge,
} from './anchorBridge';
import {fundBridgeWithLumens} from './walletToBridge';
import {useAppStore} from '../../state/appStore';

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
    readonly code:
      | 'UNSUPPORTED_ACCOUNT'
      | 'ANCHOR_UNAVAILABLE'
      | 'TRUSTLINE_FAILED'
      | 'INVALID_AMOUNT'
      | 'REFUSED',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Whether this deployment's anchor is the sandbox, which is the only kind with
 * a bank that can be told to pretend money arrived.
 */
export const IS_SANDBOX_ANCHOR = LIRA_ANCHOR_HOME_DOMAIN.includes('mock');

/**
 * The account the anchor deals with, which is not always the account holding
 * the money.
 *
 * A recovery-phrase wallet is both: it signs the SEP-10 challenge and it is
 * where the USDC lands. A smart wallet can be neither - the anchor
 * authenticates accounts rather than contracts, and refuses a contract address
 * as a destination - so it is fronted by a bridge, and the money is moved
 * across in a second step. See `anchorBridge.ts` for the three tests that
 * established this.
 */
type RampAccount =
  | {kind: 'classic'; keypair: Keypair; address: string}
  | {kind: 'bridged'; bridge: AnchorBridge; address: string; smartWalletContractId: string};

async function resolveRampAccount(reason: string): Promise<RampAccount> {
  const {smartWallet} = useAppStore.getState();
  if (smartWallet) {
    const bridge = await ensureBridgeAccount();
    // The wallet pays for its own bridge. Friendbot throttles by address, so a
    // room of people on one network would otherwise be told the ramp is
    // unavailable after the first few.
    await fundBridgeAccount(bridge, createStellarConfig('testnet'), amount =>
      fundBridgeWithLumens({
        bridge,
        smartWalletContractId: smartWallet.contractId,
        amountStroops: amount,
      }),
    );
    return {
      kind: 'bridged',
      bridge,
      address: bridge.address,
      smartWalletContractId: smartWallet.contractId,
    };
  }
  const keypair = keypairFromSecret(await loadSigningKey(reason));
  return {kind: 'classic', keypair, address: keypair.publicKey()};
}

function challengeSigner(account: RampAccount) {
  const keypair = account.kind === 'classic' ? account.keypair : account.bridge.keypair;
  return {
    accountId: account.address,
    signTransaction: async (xdr: string, {networkPassphrase}: {networkPassphrase: string}) => {
      const challenge = TransactionBuilder.fromXDR(xdr, networkPassphrase);
      challenge.sign(keypair);
      return challenge.toXDR();
    },
  };
}

/**
 * Refuses an amount before anything else happens.
 *
 * The device prompt is the expensive step — it spends the customer's attention
 * and their trust — so the number is checked before their finger is asked for.
 * Sending an amount the wallet cannot cover meant a fingerprint, a sign-in, a
 * withdrawal opened at the anchor, and only then "the network rejected the
 * payment", which is true and tells nobody what went wrong.
 */
export function assertPayableAmount(
  amount: string,
  options: {available?: string; unit: string} = {unit: ''},
): number {
  const value = Number(amount);
  if (!amount.trim() || !Number.isFinite(value) || value <= 0) {
    throw new LiraRampError('INVALID_AMOUNT', 'Enter an amount greater than zero.');
  }
  if (options.available !== undefined && value > Number(options.available)) {
    throw new LiraRampError(
      'INVALID_AMOUNT',
      `You hold ${options.available} ${options.unit}. Enter that or less.`,
    );
  }
  return value;
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
  /**
   * Present when the anchor is paying a bridge rather than the wallet itself,
   * which is every smart-wallet deposit. The money is not the customer's to
   * spend until it has been moved across.
   */
  sweep?: {bridge: AnchorBridge; smartWalletContractId: string};
};

export type LiraDepositStatus = {
  status: string;
  /** Terminal either way; a caller can stop polling. */
  settled: boolean;
  failed: boolean;
  amountIn?: string;
  amountOut?: string;
  stellarTransactionId?: string;
  /**
   * Set when the anchor could not pay the wallet directly and left the money in
   * a claimable balance instead. This anchor advertises
   * `features.claimable_balances: true` and does exactly that when the
   * destination has no trustline for the asset.
   *
   * It matters because the anchor still calls the transfer `completed`. Without
   * reading this the app would report a finished deposit while the balance shows
   * nothing, which is the one thing this product refuses to do: money that has
   * not arrived must never look like money that has.
   */
  claimableBalanceId?: string;
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
  assertPayableAmount(input.amountTry, {unit: 'TRY'});
  const anchor = await discover();
  const usdc = anchor.currencies.find(currency => currency.code === 'USDC');
  const transferServer = anchor.transferServerSep6;
  if (!transferServer || !usdc?.issuer) {
    throw new LiraRampError('ANCHOR_UNAVAILABLE', 'The lira anchor is not accepting deposits right now.');
  }
  if (!anchor.webAuthEndpoint) {
    throw new LiraRampError('UNSUPPORTED_ACCOUNT', 'The lira anchor cannot verify this wallet.');
  }

  const account = await resolveRampAccount(input.reason ?? `Connect to ${anchor.homeDomain}`);
  if (account.kind === 'classic' && account.address !== input.address) {
    throw new LiraRampError(
      'UNSUPPORTED_ACCOUNT',
      'The key on this phone does not match the wallet it shows.',
    );
  }

  const config = createStellarConfig('testnet');
  // Whichever account the anchor pays is a classic one, and a classic account
  // cannot hold USDC without a line open for it.
  const receiving = account.kind === 'classic' ? account.keypair : account.bridge.keypair;
  try {
    await ensureTrustline(receiving, {code: 'USDC', issuer: usdc.issuer}, config);
  } catch (error) {
    throw new LiraRampError(
      'TRUSTLINE_FAILED',
      error instanceof Error ? error.message : 'This wallet could not open a line for USDC.',
    );
  }

  const session = await authenticate(anchor, challengeSigner(account));

  const url = new URL(`${transferServer}/deposit-exchange`);
  url.searchParams.set('asset_code', 'USDC');
  url.searchParams.set('source_asset', 'iso4217:TRY');
  url.searchParams.set('amount', input.amountTry);
  url.searchParams.set('account', account.address);

  const opened = await openExchangeTransfer(
    url,
    'destination_asset',
    `stellar:USDC:${usdc.issuer}`,
    'USDC',
    session,
  );
  const transactionId = String(opened.id ?? '');
  if (!transactionId) {
    throw new LiraRampError('REFUSED', 'The anchor opened no deposit for this wallet.');
  }

  logger.info('lira_deposit_opened', {
    transactionId,
    amountTry: input.amountTry,
    bridged: account.kind === 'bridged',
  });
  return {
    transactionId,
    instructions: readInstructions(opened),
    session,
    transferServer,
    simulateUrl: `${transferServer}/tx/${transactionId}/simulate-bank-transfer`,
    ...(account.kind === 'bridged'
      ? {
          // The money lands on the bridge; `settleLiraDeposit` moves it the rest
          // of the way. Carrying that here keeps the screen from having to know
          // which kind of account it is looking at.
          sweep: {bridge: account.bridge, smartWalletContractId: account.smartWalletContractId},
        }
      : {}),
  };
}

/**
 * Finishes a deposit that the anchor has already paid.
 *
 * For a recovery-phrase wallet the anchor paid it directly and there is nothing
 * left to do. For a smart wallet the money is sitting on the bridge, and this is
 * the step that moves it into the wallet the customer actually sees. Until it
 * runs, the deposit is not settled however complete the anchor calls it.
 */
export async function settleLiraDeposit(
  started: StartedLiraDeposit,
): Promise<{movedStroops: bigint; transactionHash: string | null}> {
  if (!started.sweep) return {movedStroops: 0n, transactionHash: null};
  const anchor = await discover();
  const usdc = anchor.currencies.find(currency => currency.code === 'USDC');
  if (!usdc?.issuer) {
    throw new LiraRampError('ANCHOR_UNAVAILABLE', 'The anchor lists no USDC issuer right now.');
  }
  const swept = await sweepToSmartWallet({
    bridge: started.sweep.bridge,
    smartWalletContractId: started.sweep.smartWalletContractId,
    assetCode: 'USDC',
    assetIssuer: usdc.issuer,
    config: createStellarConfig('testnet'),
  });
  return {movedStroops: swept.amount, transactionHash: swept.transactionHash};
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


/**
 * Opens a SEP-6 exchange transfer, tolerating an anchor that will not take the
 * asset identifier it publishes.
 *
 * SEP-6 says `source_asset` and `destination_asset` are SEP-38 identifiers, and
 * this anchor's own `/sep38/info` advertises `stellar:USDC:<issuer>`. As of
 * 2026-09-07 its `/sep6/deposit-exchange` and `/sep6/withdraw-exchange` refuse
 * that exact string and accept only a bare `USDC`, which is a regression on
 * their side and has been reported.
 *
 * The spec-correct value is still what goes first, so nothing here has to
 * change when they fix it. The bare code is a second attempt, made only for
 * this one error, so a genuine "unsupported asset" still surfaces as one.
 */
async function openExchangeTransfer(
  url: URL,
  assetParam: 'source_asset' | 'destination_asset',
  qualified: string,
  bareCode: string,
  session: SessionToken,
): Promise<Record<string, unknown>> {
  url.searchParams.set(assetParam, qualified);
  try {
    return await readJson(url.toString(), {headers: {Authorization: `Bearer ${session.token}`}});
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!/unsupported (source|destination)_asset/i.test(message)) throw error;
    logger.info('anchor_rejected_sep38_asset_identifier', {assetParam, qualified});
    url.searchParams.set(assetParam, bareCode);
    return readJson(url.toString(), {headers: {Authorization: `Bearer ${session.token}`}});
  }
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
  const claimableBalanceId = transaction.claimable_balance_id
    ? String(transaction.claimable_balance_id)
    : undefined;
  return {
    status,
    // A completed transfer whose money is sitting in a claimable balance has
    // not reached the wallet, so it is not settled until it is claimed.
    settled: status === 'completed' && !claimableBalanceId,
    failed: status === 'error' || status === 'refunded',
    ...(claimableBalanceId ? {claimableBalanceId} : {}),
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
  available?: string;
  reason?: string;
  /**
   * Moves the money out of a smart wallet and onto the bridge, which only the
   * wallet's own signer can authorize. It is passed in rather than reached for
   * so this module stays out of the payment-authorization business.
   */
  moveToBridge: (input: {
    bridge: AnchorBridge;
    smartWalletContractId: string;
    assetIssuer: string;
    amountUsdc: string;
  }) => Promise<void>;
}): Promise<StartedLiraWithdrawal> {
  assertPayableAmount(input.amountUsdc, {
    unit: 'USDC',
    ...(input.available === undefined ? {} : {available: input.available}),
  });
  const anchor = await discover();
  const usdc = anchor.currencies.find(currency => currency.code === 'USDC');
  const transferServer = anchor.transferServerSep6;
  if (!transferServer || !usdc?.issuer || !anchor.webAuthEndpoint) {
    throw new LiraRampError('ANCHOR_UNAVAILABLE', 'The lira anchor is not paying out right now.');
  }

  const rampAccount = await resolveRampAccount(
    input.reason ?? `Cash out ${input.amountUsdc} USDC`,
  );
  if (rampAccount.kind === 'classic' && rampAccount.address !== input.address) {
    throw new LiraRampError(
      'UNSUPPORTED_ACCOUNT',
      'The key on this phone does not match the wallet it shows.',
    );
  }

  const session = await authenticate(anchor, challengeSigner(rampAccount));

  const url = new URL(`${transferServer}/withdraw-exchange`);
  url.searchParams.set('asset_code', 'USDC');
  url.searchParams.set('destination_asset', 'iso4217:TRY');
  url.searchParams.set('amount', input.amountUsdc);

  const opened = await openExchangeTransfer(
    url,
    'source_asset',
    `stellar:USDC:${usdc.issuer}`,
    'USDC',
    session,
  );
  const treasury = String(opened.account_id ?? '');
  const transactionId = String(opened.id ?? '');
  if (!treasury || !transactionId) {
    throw new LiraRampError('REFUSED', 'The anchor opened no withdrawal for this wallet.');
  }
  const memo = opened.memo === undefined || opened.memo === null ? undefined : String(opened.memo);

  const config = createStellarConfig('testnet');
  const server = new rpc.Server(config.rpcUrl);

  // The anchor is always paid by a classic account, whichever wallet the money
  // came from. A smart wallet cannot do it: a Soroban transaction cannot carry
  // the memo that routes the withdrawal, and its transfer would not appear in
  // the payments stream the anchor watches. So the wallet funds the bridge
  // first, and the bridge makes the payment.
  if (rampAccount.kind === 'bridged') {
    await input.moveToBridge({
      bridge: rampAccount.bridge,
      smartWalletContractId: rampAccount.smartWalletContractId,
      assetIssuer: usdc.issuer,
      amountUsdc: input.amountUsdc,
    });
  }

  const keypair = rampAccount.kind === 'classic' ? rampAccount.keypair : rampAccount.bridge.keypair;
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

/**
 * Takes money the anchor left in a claimable balance and puts it in the wallet.
 *
 * The anchor does this when the destination has no trustline for the asset, and
 * still calls the transfer complete. The money is genuinely the customer's -
 * it just needs one more transaction, which only they can send. Opening the
 * trustline first is part of the same job: claiming into an account that still
 * cannot hold the asset would fail for the same reason the payment did.
 */
export async function claimLiraDeposit(input: {
  claimableBalanceId: string;
  config?: ReturnType<typeof createStellarConfig>;
}): Promise<{transactionHash: string}> {
  const config = input.config ?? createStellarConfig('testnet');
  // The issuer comes from the anchor's own stellar.toml rather than a constant.
  // Its own migration guide is explicit about this: the issuer changes between
  // networks, and a hardcoded one is a bug that only shows up on mainnet.
  const anchor = await discover();
  const usdc = anchor.currencies.find(currency => currency.code === 'USDC');
  if (!usdc?.issuer) {
    throw new LiraRampError('ANCHOR_UNAVAILABLE', 'The anchor lists no USDC issuer right now.');
  }
  // The prompt names what it is for: this is the customer's own money being
  // moved into their own wallet, not a payment to anyone.
  const secret = await loadSigningKey('Claim the deposit into your wallet');
  const keypair = keypairFromSecret(secret);
  await ensureTrustline(keypair, {code: 'USDC', issuer: usdc.issuer}, config);

  const server = new rpc.Server(config.rpcUrl);
  const account = await server.getAccount(keypair.publicKey());
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(Operation.claimClaimableBalance({balanceId: input.claimableBalanceId}))
    .setTimeout(60)
    .build();
  transaction.sign(keypair);

  const sent = await server.sendTransaction(transaction);
  if (sent.status === 'ERROR') {
    logger.error('claimable_balance_claim_failed', {status: sent.status});
    throw new LiraRampError('REFUSED', 'The deposit could not be claimed into this wallet.');
  }
  const confirmed = await server.pollTransaction(sent.hash, {attempts: 20});
  if (confirmed.status !== 'SUCCESS') {
    throw new LiraRampError('REFUSED', 'The deposit could not be claimed into this wallet.');
  }
  logger.info('claimable_balance_claimed', {transactionHash: sent.hash});
  return {transactionHash: sent.hash};
}
