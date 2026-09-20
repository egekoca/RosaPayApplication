import {Asset, BASE_FEE, Operation, TransactionBuilder, rpc, type Keypair} from '@stellar/stellar-sdk';
import {createStellarConfig, readAssetBalance, type StellarConfig} from '@rosapay/stellar';
import {logger} from '../../shared/logger';

export class AccountSetupError extends Error {
  override readonly name = 'AccountSetupError';

  constructor(
    readonly code: 'FUNDING_UNAVAILABLE' | 'NOT_FUNDED' | 'TRUSTLINE_FAILED',
    message: string,
  ) {
    super(message);
  }
}

/**
 * Whether the ledger has heard of this account yet.
 *
 * A classic Stellar account does not exist until something funds it, and the
 * smart wallet this replaced had no such state — it was deployed, so it was
 * there. Every screen that assumes an account exists has to cope with the gap
 * between deriving an address and the ledger holding one.
 */
export async function accountExists(
  address: string,
  config: StellarConfig = createStellarConfig('testnet'),
): Promise<boolean> {
  try {
    await new rpc.Server(config.rpcUrl).getAccount(address);
    return true;
  } catch {
    return false;
  }
}

export type FundOnTestnetOptions = {
  /** How many times to ask, in total. One is the old behaviour: ask once. */
  attempts?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Gives a brand-new account its base reserve on Testnet.
 *
 * Friendbot is the network's own faucet, which is why nothing here needs a
 * funded deployer. It is Testnet-only by design: on a live network the customer
 * arrives with an account that already exists, and inventing one for them is not
 * this app's business.
 *
 * `attempts` defaults to one, which is the whole of what this used to do. A
 * customer's own onboarding asks for more: the account is created either way,
 * so a single dropped request or a momentary faucet hiccup used to be the
 * difference between a wallet that could pay and one that silently could not,
 * with nothing on screen to tell the two apart.
 */
export async function fundOnTestnet(
  address: string,
  config: StellarConfig = createStellarConfig('testnet'),
  fetcher: typeof fetch = fetch,
  {attempts = 1, retryDelayMs = 1_500, sleep = defaultSleep}: FundOnTestnetOptions = {},
): Promise<void> {
  if (!config.friendbotUrl) {
    throw new AccountSetupError(
      'FUNDING_UNAVAILABLE',
      'This network has no faucet, so the account has to be funded before it can pay.',
    );
  }

  for (let attempt = 1; ; attempt += 1) {
    try {
      let response: Response;
      try {
        response = await fetcher(`${config.friendbotUrl}?addr=${encodeURIComponent(address)}`);
      } catch {
        throw new AccountSetupError(
          'FUNDING_UNAVAILABLE',
          'The Testnet faucet could not be reached, so this wallet has no starting balance yet.',
        );
      }

      // Friendbot answers 400 for an account it has already funded, which is a
      // success from here: the wallet exists and can pay.
      if (!response.ok && !(await accountExists(address, config))) {
        logger.error('friendbot_failed', {status: String(response.status), attempt});
        throw new AccountSetupError(
          'NOT_FUNDED',
          'The Testnet faucet would not fund this wallet. It has no starting balance yet.',
        );
      }
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      await sleep(retryDelayMs);
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Gives the wallet room to hold a credit asset.
 *
 * The smart wallet this replaced needed nothing: a Stellar Asset Contract keeps
 * a contract balance in its own storage. A classic account does not work that
 * way — without a trustline USDC cannot arrive at all, and the payment fails at
 * the counter with the customer already committed. So the line is opened here,
 * once, rather than discovered later.
 *
 * It is the customer's own operation on their own account, so it does not go
 * through the relayer: they sign it and pay the small fee themselves. It also
 * locks up half a lumen of reserve, which is why it is not done for every asset
 * the app knows about — only the one being asked for.
 */
export async function ensureTrustline(
  keypair: Keypair,
  asset: {code: string; issuer: string},
  config: StellarConfig = createStellarConfig('testnet'),
): Promise<{created: boolean}> {
  const server = new rpc.Server(config.rpcUrl);
  const stellarAsset = new Asset(asset.code, asset.issuer);

  // A balance that reads at all is a line that is already open; a missing
  // trustline makes the asset contract refuse rather than answer zero. That is
  // the same signal `useWalletBalance` relies on, read the same way.
  const contractId = stellarAsset.contractId(config.networkPassphrase);
  const open = await readAssetBalance(config, keypair.publicKey(), contractId, server).then(
    () => true,
    () => false,
  );
  if (open) return {created: false};

  const account = await server.getAccount(keypair.publicKey());
  const transaction = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(Operation.changeTrust({asset: stellarAsset}))
    .setTimeout(60)
    .build();
  transaction.sign(keypair);

  let sent;
  try {
    sent = await server.sendTransaction(transaction);
  } catch {
    throw new AccountSetupError(
      'TRUSTLINE_FAILED',
      `This wallet could not open a line for ${asset.code}. It needs about 0.5 XLM spare to hold a new asset.`,
    );
  }
  if (sent.status === 'ERROR') {
    logger.error('trustline_failed', {code: asset.code, status: sent.status});
    throw new AccountSetupError(
      'TRUSTLINE_FAILED',
      `This wallet could not open a line for ${asset.code}. It needs about 0.5 XLM spare to hold a new asset.`,
    );
  }

  // Submission is not settlement. Reporting success here would let the anchor
  // be told to send an asset the ledger cannot yet deliver.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    const result = await server.getTransaction(sent.hash).catch(() => undefined);
    if (result?.status === 'SUCCESS') return {created: true};
    if (result?.status === 'FAILED') break;
  }

  logger.error('trustline_failed', {code: asset.code});
  throw new AccountSetupError(
    'TRUSTLINE_FAILED',
    `This wallet could not open a line for ${asset.code}. It needs about 0.5 XLM spare to hold a new asset.`,
  );
}
