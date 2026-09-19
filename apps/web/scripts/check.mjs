import {access, readFile} from 'node:fs/promises';

const requiredFiles = [
  'index.html',
  'styles.css',
  'script.js',
  'assets/lumenadepay-logo.png',
  'assets/app-welcome.png',
  'vercel.json',
];

await Promise.all(requiredFiles.map(file => access(new URL(`../${file}`, import.meta.url))));

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
// What the page must not lose: the product's name and claim, a way to get it,
// and the on-chain evidence behind "not a mockup". Marketing lines come and go
// and should not be able to fail a build.
const requiredCopy = [
  'Lumenade Pay',
  'Scan. Approve.',
  'App Store',
  'Google Play',
  'Stellar Testnet',
  'CAV65DKNKPQZMY2MBXEDDBBCLMTVNIZUJVYFNDRUSKNCATIFKX66CSVO',
  'b4a0cc9b8c7e3a3beb4b7a24c93517465ac2b731862451917c4ff24f2bcd1513',
  // The page must keep saying the product is more than a QR reader; the
  // integration, the fiat rail and the custody model are what make that true.
  'Soroswap',
  'SEP-6',
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

console.log('Lumenade Pay landing page checks passed');
