import {Keypair, Networks, TransactionBuilder} from '@stellar/stellar-sdk';
import {
  authenticate,
  discoverAnchor,
  pollTransaction,
  startInteractive,
  transactionPhase,
} from '@rosapay/anchor';
import {testnetDeployment} from '@rosapay/stellar';

const homeDomain = process.env.ANCHOR_HOME_DOMAIN ?? testnetDeployment.anchor.homeDomain;
const assetCode = process.env.ANCHOR_ASSET_CODE ?? 'native';
const attempts = Number(process.env.ANCHOR_POLL_ATTEMPTS ?? '2');
const intervalMs = Number(process.env.ANCHOR_POLL_INTERVAL_MS ?? '1000');
const trustedInteractiveOrigins = (
  process.env.ANCHOR_TRUSTED_INTERACTIVE_ORIGINS ?? testnetDeployment.anchor.interactiveOrigins.join(',')
).split(',').map(origin => origin.trim()).filter(Boolean);

const anchor = await discoverAnchor(homeDomain);
if (anchor.networkPassphrase !== Networks.TESTNET) {
  throw new Error(`${homeDomain} is not advertising the configured Stellar Testnet`);
}
if (!anchor.webAuthEndpoint || !anchor.transferServerSep24) {
  throw new Error(`${homeDomain} does not publish both SEP-10 and SEP-24 endpoints`);
}

const currency = anchor.currencies.find(candidate => candidate.code === assetCode);
if (!currency) {
  throw new Error(`${homeDomain} does not publish ${assetCode} as a supported asset`);
}

// The proof account is ephemeral and exists only in this process. Its secret is
// never written, logged, placed in an environment variable, or added to a
// deployment manifest.
const account = Keypair.random();
const friendbot = new URL('https://friendbot.stellar.org');
friendbot.searchParams.set('addr', account.publicKey());
const funded = await fetch(friendbot);
if (!funded.ok) {
  throw new Error(`Friendbot could not fund the ephemeral proof account (${funded.status})`);
}

const session = await authenticate(anchor, {
  accountId: account.publicKey(),
  async signTransaction(xdr, {networkPassphrase}) {
    const transaction = TransactionBuilder.fromXDR(xdr, networkPassphrase);
    transaction.sign(account);
    return transaction.toXDR();
  },
});

const interactive = await startInteractive({
  anchor,
  session,
  kind: 'deposit',
  assetCode,
  ...(currency.issuer ? {assetIssuer: currency.issuer} : {}),
  account: account.publicKey(),
  trustedInteractiveOrigins,
});

const transaction = await pollTransaction({
  anchor,
  session,
  transactionId: interactive.transactionId,
  attempts,
  intervalMs,
});

console.log(JSON.stringify({
  proof: 'SEP-10 authenticated; SEP-24 deposit started and read back',
  homeDomain: anchor.homeDomain,
  network: 'testnet',
  authProtocol: 'SEP-10',
  assetCode,
  account: account.publicKey(),
  interactiveOrigin: new URL(interactive.url).origin,
  transactionId: interactive.transactionId,
  status: transaction.status,
  phase: transactionPhase(transaction.status),
}, null, 2));
