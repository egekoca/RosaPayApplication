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
  'CBX7XUIEFWMRBZBEJGZ7SJAFJXFCAB6VFJKOAFMUFAEXML2UVOAZFAQO',
  'c8414bdabd495b987a45588a09dc95ef3b4a821c39f08696895ea3720025a777',
];

for (const value of requiredCopy) {
  if (!html.includes(value)) {
    throw new Error(`Landing page is missing required evidence: ${value}`);
  }
}

console.log('Lumenade Pay landing page checks passed');
