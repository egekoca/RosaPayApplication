import {
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import {createStellarConfig, type StellarConfig} from '@rosapay/stellar';
import {logger} from '../../shared/logger';

/**
 * The classic account that lets a smart wallet reach the anchor.
 *
 * Three facts, each established against the live anchor rather than assumed,
 * decide that this has to exist and what shape it takes:
 *
 * 1. **SEP-10 authenticates an account.** It works by having an account sign a
 *    challenge transaction. A contract account cannot; SEP-45 exists for that
 *    and this anchor does not publish it.
 * 2. **A deposit must land on a `G…`.** All three SEP-6 doors answer
 *    `'account' must be a Stellar G... or M... address (contract addresses are
 *    not supported)`, and `claimable_balance_supported` does not change it.
 * 3. **A contract cannot pay a withdrawal.** Two independent reasons: Soroban
 *    transactions cannot carry a memo at all, and a Stellar Asset Contract
 *    transfer - even to a muxed address, which the SAC does accept - reaches
 *    Horizon as `invoke_host_function` rather than as a payment, so a watcher
 *    reading the payments stream never matches it.
 *
 * So the bridge is on both legs. Money is only ever passing through it:
 *
 * ```text
 * in    anchor ──payment──▶ bridge (G) ──SAC transfer──▶ smart wallet (C)
 * out   smart wallet (C) ──SAC transfer──▶ bridge (G) ──payment+memo──▶ anchor
 * ```
 *
 * The key is not something the customer backs up. It holds nothing at rest, and
 * a lost one is replaced rather than recovered - which is the whole reason the
 * wallet's own key can stay in the secure element where it cannot be copied.
 */

export class AnchorBridgeError extends Error {
  override readonly name = 'AnchorBridgeError';

  constructor(
    readonly code: 'UNFUNDED' | 'SWEEP_FAILED' | 'UNAVAILABLE',
    message: string,
  ) {
    super(message);
  }
}

/**
 * The contract that moves an asset.
 *
 * Native lumens are not an issued asset and their contract is derived from the
 * network alone, so a code-and-issuer pair cannot describe them. Naming that
 * here keeps every caller from having to know it.
 */
function assetContract(code: string, issuer: string, networkPassphrase: string): string {
  const asset = code === 'native' || !issuer ? Asset.native() : new Asset(code, issuer);
  return asset.contractId(networkPassphrase);
}

/** Base reserve, a trustline, and enough left over for a few fees. */
const MINIMUM_FLOAT_STROOPS = 30_000_000n; // 3 XLM

export type AnchorBridge = {
  address: string;
  keypair: Keypair;
};

/**
 * Wraps a keypair as a bridge. Where the key comes from is the caller's problem
 * on purpose: this module has to stay importable outside React Native so the
 * Testnet proof runs this code rather than a copy of it.
 */
export function bridgeFrom(keypair: Keypair): AnchorBridge {
  return {address: keypair.publicKey(), keypair};
}

/**
 * Puts enough lumens in the bridge to exist, hold USDC and pay a few fees.
 *
 * Friendbot is the obvious answer and the wrong default. It rate-limits by
 * address, so a room of people on one router - which is exactly what a launch
 * day is - throttles after the first few and everyone else is told the ramp is
 * unavailable. The wallet already holds a funded balance of its own, so the
 * money comes from there when there is a wallet to take it from, and Friendbot
 * is the fallback for the first account on a machine that has no wallet yet.
 *
 * On a real network neither applies and it would be the operator's float, which
 * is why the amount is a named minimum rather than a literal scattered through
 * the flow.
 */
export async function fundBridgeAccount(
  bridge: AnchorBridge,
  config: StellarConfig = createStellarConfig('testnet'),
  fundFromWallet?: (amountStroops: bigint) => Promise<void>,
): Promise<{funded: boolean; source?: 'wallet' | 'friendbot'}> {
  const server = new rpc.Server(config.rpcUrl);
  const balance = await nativeBalance(server, bridge.address, config);
  if (balance >= MINIMUM_FLOAT_STROOPS) return {funded: false};

  if (fundFromWallet) {
    try {
      await fundFromWallet(MINIMUM_FLOAT_STROOPS - balance);
      logger.info('anchor_bridge_funded', {address: bridge.address, source: 'wallet'});
      return {funded: true, source: 'wallet'};
    } catch (error) {
      // Falling through to Friendbot rather than failing: on Testnet it will
      // usually work, and a ramp that refuses to start is worse than a slower
      // one. The balance check below is what decides either way.
      logger.info('anchor_bridge_wallet_funding_failed', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  if (!config.friendbotUrl) {
    throw new AnchorBridgeError(
      'UNFUNDED',
      'The account that talks to the anchor has no lumens for fees.',
    );
  }
  const response = await fetch(`${config.friendbotUrl}?addr=${bridge.address}`).catch(() => undefined);
  // Friendbot refuses an account it has already funded, and throttles a busy
  // address. Neither is decided here: the balance is.
  if (
    (!response || !response.ok) &&
    (await nativeBalance(server, bridge.address, config)) < MINIMUM_FLOAT_STROOPS
  ) {
    throw new AnchorBridgeError('UNFUNDED', 'The account that talks to the anchor could not be funded.');
  }
  logger.info('anchor_bridge_funded', {address: bridge.address, source: 'friendbot'});
  return {funded: true, source: 'friendbot'};
}

async function nativeBalance(
  server: rpc.Server,
  address: string,
  config: StellarConfig,
): Promise<bigint> {
  try {
    const account = await server.getAccount(address);
    void account;
  } catch {
    return 0n;
  }
  return readSacBalance(server, assetContract('native', '', config.networkPassphrase), address, config);
}

async function readSacBalance(
  server: rpc.Server,
  sac: string,
  holder: string,
  config: StellarConfig,
): Promise<bigint> {
  const source = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
  const transaction = new TransactionBuilder(
    new (await import('@stellar/stellar-sdk')).Account(source, '0'),
    {fee: '100000', networkPassphrase: config.networkPassphrase},
  )
    .addOperation(new Contract(sac).call('balance', nativeToScVal(holder, {type: 'address'})))
    .setTimeout(30)
    .build();
  const simulation = await server.simulateTransaction(transaction);
  if (!rpc.Api.isSimulationSuccess(simulation) || !simulation.result) return 0n;
  return BigInt(scValToNative(simulation.result.retval));
}

/**
 * Moves everything the bridge holds of an asset into the smart wallet.
 *
 * This runs the moment a deposit lands, so the money spends as little time as
 * possible in an account whose key is only software. It sweeps the balance
 * rather than a named amount, because the anchor's fee means what arrives is
 * never exactly what was asked for, and a leftover dust balance in the bridge
 * is money the customer cannot see.
 */
export async function sweepToSmartWallet(input: {
  bridge: AnchorBridge;
  smartWalletContractId: string;
  assetCode: string;
  assetIssuer: string;
  config?: StellarConfig;
}): Promise<{amount: bigint; transactionHash: string} | {amount: 0n; transactionHash: null}> {
  const config = input.config ?? createStellarConfig('testnet');
  const server = new rpc.Server(config.rpcUrl);
  const sac = assetContract(input.assetCode, input.assetIssuer, config.networkPassphrase);

  const amount = await readSacBalance(server, sac, input.bridge.address, config);
  if (amount <= 0n) return {amount: 0n, transactionHash: null};

  // A contract account holds a SAC balance in contract storage, so this is an
  // invocation rather than a classic payment. It is also why the wallet needs no
  // trustline on the receiving side.
  const call = new Contract(sac).call(
    'transfer',
    nativeToScVal(input.bridge.address, {type: 'address'}),
    nativeToScVal(input.smartWalletContractId, {type: 'address'}),
    nativeToScVal(amount, {type: 'i128'}),
  );
  const built = new TransactionBuilder(await server.getAccount(input.bridge.address), {
    fee: '2000000',
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(call)
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(built);
  prepared.sign(input.bridge.keypair);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === 'ERROR') {
    logger.error('anchor_bridge_sweep_failed', {status: sent.status});
    throw new AnchorBridgeError(
      'SWEEP_FAILED',
      'The deposit arrived but could not be moved into your wallet.',
    );
  }
  const confirmed = await server.pollTransaction(sent.hash, {attempts: 20});
  if (confirmed.status !== 'SUCCESS') {
    throw new AnchorBridgeError(
      'SWEEP_FAILED',
      'The deposit arrived but could not be moved into your wallet.',
    );
  }
  logger.info('anchor_bridge_swept', {amount: amount.toString(), transactionHash: sent.hash});
  return {amount, transactionHash: sent.hash};
}

/**
 * Moves money out of the smart wallet and into the bridge, ready to be paid to
 * the anchor.
 *
 * The caller supplies the authorization, because only the wallet's own signer
 * can give it and that lives behind the platform prompt.
 */
export async function fundBridgeFromSmartWallet(input: {
  bridge: AnchorBridge;
  smartWalletContractId: string;
  assetCode: string;
  assetIssuer: string;
  amount: bigint;
  authorizeEntry: Parameters<typeof authorizeWalletCall>[0]['authorizeEntry'];
  relayerSign(xdr: string): Promise<{signedTxXdr: string}>;
  relayerAddress: string;
  config?: StellarConfig;
}): Promise<{transactionHash: string}> {
  const config = input.config ?? createStellarConfig('testnet');
  const sac = assetContract(input.assetCode, input.assetIssuer, config.networkPassphrase);
  return authorizeWalletCall({
    config,
    relayerAddress: input.relayerAddress,
    relayerSign: input.relayerSign,
    authorizeEntry: input.authorizeEntry,
    call: new Contract(sac).call(
      'transfer',
      nativeToScVal(input.smartWalletContractId, {type: 'address'}),
      nativeToScVal(input.bridge.address, {type: 'address'}),
      nativeToScVal(input.amount, {type: 'i128'}),
    ),
  });
}

/**
 * Pays the anchor from the bridge, with the memo that routes the withdrawal.
 *
 * This is a classic payment on purpose. It is the only shape the anchor's
 * watcher recognises: a Soroban transaction cannot carry a memo, and a contract
 * transfer does not appear in the payments stream it reads.
 */
export async function payAnchorFromBridge(input: {
  bridge: AnchorBridge;
  destination: string;
  memo: string;
  assetCode: string;
  assetIssuer: string;
  amount: string;
  config?: StellarConfig;
}): Promise<{transactionHash: string}> {
  const config = input.config ?? createStellarConfig('testnet');
  const server = new rpc.Server(config.rpcUrl);
  const transaction = new TransactionBuilder(await server.getAccount(input.bridge.address), {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      Operation.payment({
        destination: input.destination,
        asset: new Asset(input.assetCode, input.assetIssuer),
        amount: input.amount,
      }),
    )
    .addMemo(Memo.id(input.memo))
    .setTimeout(60)
    .build();
  transaction.sign(input.bridge.keypair);

  const sent = await server.sendTransaction(transaction);
  if (sent.status === 'ERROR') {
    throw new AnchorBridgeError('UNAVAILABLE', 'The anchor could not be paid from this wallet.');
  }
  const confirmed = await server.pollTransaction(sent.hash, {attempts: 20});
  if (confirmed.status !== 'SUCCESS') {
    throw new AnchorBridgeError('UNAVAILABLE', 'The anchor could not be paid from this wallet.');
  }
  return {transactionHash: sent.hash};
}

/** Simulate, have the wallet authorize, let the relayer pay the fee, submit. */
async function authorizeWalletCall(input: {
  config: StellarConfig;
  relayerAddress: string;
  relayerSign(xdr: string): Promise<{signedTxXdr: string}>;
  authorizeEntry(
    entry: import('@stellar/stellar-sdk').xdr.SorobanAuthorizationEntry,
    signer: unknown,
    validUntilLedger: number,
    networkPassphrase?: string,
  ): Promise<import('@stellar/stellar-sdk').xdr.SorobanAuthorizationEntry>;
  call: import('@stellar/stellar-sdk').xdr.Operation;
}): Promise<{transactionHash: string}> {
  const server = new rpc.Server(input.config.rpcUrl);
  const built = new TransactionBuilder(await server.getAccount(input.relayerAddress), {
    fee: '5000000',
    networkPassphrase: input.config.networkPassphrase,
  })
    .addOperation(input.call)
    .setTimeout(60)
    .build();

  const simulation = await server.simulateTransaction(built);
  if (!rpc.Api.isSimulationSuccess(simulation)) {
    throw new AnchorBridgeError('UNAVAILABLE', 'The wallet could not prepare this transfer.');
  }
  const validUntil = (await server.getLatestLedger()).sequence + 120;
  const signed = await Promise.all(
    (simulation.result?.auth ?? []).map(entry =>
      input.authorizeEntry(entry, undefined, validUntil, input.config.networkPassphrase),
    ),
  );

  const authorized = new TransactionBuilder(await server.getAccount(input.relayerAddress), {
    fee: '5000000',
    networkPassphrase: input.config.networkPassphrase,
  })
    .addOperation(
      Operation.invokeHostFunction({
        func: input.call.body().invokeHostFunctionOp().hostFunction(),
        auth: signed,
      }),
    )
    .setTimeout(60)
    .build();

  const prepared = await server.prepareTransaction(authorized);
  const {signedTxXdr} = await input.relayerSign(prepared.toXDR());
  const sent = await server.sendTransaction(
    TransactionBuilder.fromXDR(signedTxXdr, input.config.networkPassphrase),
  );
  if (sent.status === 'ERROR') {
    throw new AnchorBridgeError('UNAVAILABLE', 'The wallet transfer was rejected.');
  }
  const confirmed = await server.pollTransaction(sent.hash, {attempts: 20});
  if (confirmed.status !== 'SUCCESS') {
    throw new AnchorBridgeError('UNAVAILABLE', 'The wallet transfer did not confirm.');
  }
  return {transactionHash: sent.hash};
}
