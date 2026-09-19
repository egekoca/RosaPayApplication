import {access, readFile} from 'node:fs/promises';

const requiredFiles = [
  'index.html',
  'styles.css',
  'script.js',
  'assets/lumenadepay-logo.png',
  'vercel.json',
];

await Promise.all(requiredFiles.map(file => access(new URL(`../${file}`, import.meta.url))));

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const requiredCopy = [
  'Lumenade Pay',
  'Lumen meets lemonade.',
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
