import {access, readFile} from 'node:fs/promises';

const requiredFiles = [
  'index.html',
  'styles.css',
  'script.js',
  'assets/rosapay-logo.png',
  'vercel.json',
];

await Promise.all(requiredFiles.map(file => access(new URL(`../${file}`, import.meta.url))));

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
// What the page must not lose: the product's name and claim, a way to get it,
// and a transaction behind every claim a reader would be right to doubt.
// Marketing lines come and go and should not be able to fail a build.
//
// The standalone "Not a mockup" section is gone — it was a page of receipts
// with nothing on it — so each receipt now hangs off the claim it backs, and
// this list follows them there. The ledger card went with the section, which is
// why the contract id and the network label are no longer required: nothing on
// the page quotes them any more.
const requiredCopy = [
  'Rosa Pay',
  'Scan. Approve.',
  'App Store',
  'Google Play',
  // The visual-first sections must show the offline failure state resolving
  // into a successful payment. The benefits must retain Rosa Pay's real
  // differentiators instead of falling back to generic speed claims.
  'Payment is still possible.',
  'No terminal. No payout queue.',
  'No platform balance',
  'The customer can be offline',
  'Approve the bill. Never an address.',
  'Pay with what you hold',
  'Exact amount or nothing',
  // Paying with no signal is the page's loudest claim, so it carries the run
  // that proves the customer was not the transaction source and paid no fee.
  'f1f850aa24d55172bde1bef9428110554cffcdcdb1507bad8cd50cf987d49396',
  // The page must keep saying the product is more than a QR reader; the
  // integration, the fiat rail and the custody model are what make that true.
  'Soroswap',
  'SEP-6',
  'id="i-usdc"',
  'currency-mark--try',
  'currency-mark--xlm',
  'b4a0cc9b8c7e3a3beb4b7a24c93517465ac2b731862451917c4ff24f2bcd1513',
  // Losing a phone without losing the wallet is the claim a reader is most
  // likely to disbelieve, so the page must keep making it — with evidence.
  "Losing your phone doesn't lose it.",
  '2ed61aba82b4331ae0992d74d335deff6b61e7ce7abea6dc0009382200ee599d',
];

for (const value of requiredCopy) {
  if (!html.includes(value)) {
    throw new Error(`Landing page is missing required evidence: ${value}`);
  }
}

console.log('Rosa Pay landing page checks passed');
