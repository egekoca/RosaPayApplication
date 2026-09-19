/**
 * Proves the lira on-ramp end to end against the TR mock anchor.
 *
 * Buying USDC with Turkish lira is the thing this product is for, and it is the
 * one leg that had never been run. Everything here is the standards door — SEP-1
 * discovery, SEP-10 auth, SEP-38 for the rate, SEP-6 for the transfer — because
 * that is what a wallet speaks; the anchor's own partner API needs a key and
 * would tie the app to this one anchor.
 *
 * The bank is simulated and the Stellar leg is real testnet USDC. Nothing here
 * touches mainnet or real money.
 *
 * Run: npm run testnet:try-ramp
 */
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {authenticate, discoverAnchor} from '@rosapay/anchor';

const HOME_DOMAIN = process.env.ROSAPAY_TRY_ANCHOR ?? 'tr-mock-anchor.fly.dev';
const HORIZON = 'https://horizon-testnet.stellar.org';
const FRIENDBOT = 'https://friendbot.stellar.org';
const AMOUNT_TRY = process.env.ROSAPAY_TRY_AMOUNT ?? '500';

function log(step: string, detail: unknown) {
  console.log(`\n[${step}]`, typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2));
}

async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = body;
  }
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}: ${body.slice(0, 400)}`);
  }
  return parsed as Record<string, unknown>;
}

const anchor = await discoverAnchor(HOME_DOMAIN);
log('SEP-1', {
  homeDomain: anchor.homeDomain,
  webAuth: anchor.webAuthEndpoint,
  transferServer: anchor.transferServerSep6,
  quoteServer: anchor.quoteServer,
});
if (anchor.networkPassphrase !== Networks.TESTNET) {
  throw new Error('This anchor does not serve Stellar Testnet');
}

// A throwaway customer account: the phrase-derived wallet the app now offers is
// exactly this shape, and the smart wallet is exactly what cannot do it — a
// contract account has no key SEP-10 can challenge.
const customer = Keypair.random();
log('customer', customer.publicKey());

await fetch(`${FRIENDBOT}?addr=${customer.publicKey()}`);
const horizon = new Horizon.Server(HORIZON);
const usdc = anchor.currencies.find(currency => currency.code === 'USDC');
if (!usdc?.issuer) throw new Error('The anchor lists no USDC issuer');

// Without a trustline the USDC cannot arrive at all, and the anchor's payment
// would fail after the lira had already been taken.
const account = await horizon.loadAccount(customer.publicKey());
const trustline = new TransactionBuilder(account, {fee: BASE_FEE, networkPassphrase: Networks.TESTNET})
  .addOperation(Operation.changeTrust({asset: new Asset('USDC', usdc.issuer)}))
  .setTimeout(60)
  .build();
trustline.sign(customer);
await horizon.submitTransaction(trustline);
log('trustline', `USDC:${usdc.issuer.slice(0, 8)}… opened`);

const session = await authenticate(anchor, {
  accountId: customer.publicKey(),
  signTransaction: async (xdr, {networkPassphrase}) => {
    const challenge = TransactionBuilder.fromXDR(xdr, networkPassphrase);
    challenge.sign(customer);
    return challenge.toXDR();
  },
});
log('SEP-10', {account: session.account, protocol: session.authProtocol});

const sellAsset = 'iso4217:TRY';
const buyAsset = `stellar:USDC:${usdc.issuer}`;
const quoted = await json(
  `${anchor.quoteServer}/price?sell_asset=${encodeURIComponent(sellAsset)}` +
    `&buy_asset=${encodeURIComponent(buyAsset)}&sell_amount=${AMOUNT_TRY}&context=sep6`,
);
log('SEP-38 price', quoted);

const transferServer = anchor.transferServerSep6;
if (!transferServer) throw new Error('The anchor publishes no SEP-6 transfer server');

const depositUrl = new URL(`${transferServer}/deposit-exchange`);
depositUrl.searchParams.set('asset_code', 'USDC');
depositUrl.searchParams.set('source_asset', sellAsset);
depositUrl.searchParams.set('destination_asset', buyAsset);
depositUrl.searchParams.set('amount', AMOUNT_TRY);
depositUrl.searchParams.set('account', customer.publicKey());
const deposit = await json(depositUrl.toString(), {
  headers: {Authorization: `Bearer ${session.token}`},
});
log('SEP-6 deposit-exchange', deposit);

const transactionId = String(deposit.id);
// The sandbox bank: what a customer's actual lira transfer would trigger.
await json(`${transferServer}/tx/${transactionId}/simulate-bank-transfer`, {
  method: 'POST',
  headers: {Authorization: `Bearer ${session.token}`},
});
log('bank', `simulated ${AMOUNT_TRY} TRY arriving for ${transactionId}`);

let status = '';
let transaction: Record<string, unknown> = {};
for (let attempt = 0; attempt < 40 && status !== 'completed' && status !== 'error'; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 3_000));
  const polled = await json(`${transferServer}/transaction?id=${transactionId}`, {
    headers: {Authorization: `Bearer ${session.token}`},
  });
  transaction = (polled.transaction ?? polled) as Record<string, unknown>;
  const next = String(transaction.status);
  if (next !== status) log('SEP-6 status', next);
  status = next;
}

if (status !== 'completed') {
  throw new Error(`The deposit ended as ${status}: ${JSON.stringify(transaction).slice(0, 400)}`);
}

const settled = await horizon.loadAccount(customer.publicKey());
const held = settled.balances.find(
  balance => 'asset_code' in balance && balance.asset_code === 'USDC',
);
if (!held || Number(held.balance) <= 0) {
  throw new Error('The anchor reported completed but no USDC arrived');
}

console.log(
  `\n${JSON.stringify(
    {
      anchor: anchor.homeDomain,
      customer: customer.publicKey(),
      soldTry: AMOUNT_TRY,
      quotedPrice: quoted.price,
      totalPrice: quoted.total_price,
      expectedUsdc: quoted.buy_amount,
      receivedUsdc: held.balance,
      stellarTransaction: transaction.stellar_transaction_id ?? null,
      status,
    },
    null,
    2,
  )}`,
);
