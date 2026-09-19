import {hmac} from '@noble/hashes/hmac.js';
import {sha512} from '@noble/hashes/sha2.js';
import {generateMnemonic as bip39Generate, mnemonicToSeedSync, validateMnemonic} from '@scure/bip39';
import {wordlist} from '@scure/bip39/wordlists/english.js';
import {Keypair, StrKey} from '@stellar/stellar-sdk';

/**
 * The path every Stellar wallet agrees on. SEP-0005 fixes coin type 148 and
 * says the first account is `m/44'/148'/0'`, which is why the same twelve words
 * open the same account in Lobstr, Freighter, Vibrant and here. Getting this
 * wrong would not fail loudly — it would silently derive a different, empty
 * account and look like the customer's money had gone.
 */
const STELLAR_PATH = [44, 148, 0];

/** SLIP-0010 hardens every ed25519 index, so the offset is unconditional. */
const HARDENED = 0x8000_0000;

export class StellarKeyError extends Error {
  override readonly name = 'StellarKeyError';

  constructor(
    readonly code: 'INVALID_MNEMONIC' | 'INVALID_SECRET',
    message: string,
  ) {
    super(message);
  }
}

/** Twelve words, from the platform CSPRNG that `polyfills.ts` installs. */
export function generateRecoveryPhrase(): string {
  return bip39Generate(wordlist, 128);
}

/**
 * People paste recovery phrases out of password managers, notes apps and photos
 * of paper, and those arrive with capitals, newlines and doubled spaces. None of
 * that changes which account is meant, so it is cleaned up rather than rejected.
 */
export function normalizeRecoveryPhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function isValidRecoveryPhrase(phrase: string): boolean {
  return validateMnemonic(normalizeRecoveryPhrase(phrase), wordlist);
}

/**
 * Derives the account a recovery phrase names.
 *
 * The checksum is verified first: BIP-39 exists so that one mistyped word is
 * caught here rather than becoming a valid-looking address nobody owns.
 */
export function keypairFromRecoveryPhrase(phrase: string): Keypair {
  const normalized = normalizeRecoveryPhrase(phrase);
  if (!validateMnemonic(normalized, wordlist)) {
    throw new StellarKeyError(
      'INVALID_MNEMONIC',
      'Those words are not a valid recovery phrase. Check the spelling and the order.',
    );
  }
  const seed = mnemonicToSeedSync(normalized);
  return Keypair.fromRawEd25519Seed(Buffer.from(derivePath(seed)));
}

/** For someone who kept the raw secret rather than the words. */
export function keypairFromSecret(secret: string): Keypair {
  const trimmed = secret.trim();
  if (!StrKey.isValidEd25519SecretSeed(trimmed)) {
    throw new StellarKeyError('INVALID_SECRET', 'That is not a Stellar secret key. It starts with an S.');
  }
  return Keypair.fromSecret(trimmed);
}

/**
 * SLIP-0010 for ed25519. Short enough to read, and worth reading: the master
 * key comes from HMAC-SHA512 under a fixed curve string, and each hardened step
 * re-keys with `0x00 || key || index`. Unlike secp256k1 there is no public
 * derivation, so every index is hardened and there is no chain of public keys.
 */
function derivePath(seed: Uint8Array): Uint8Array {
  let digest = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = digest.slice(0, 32);
  let chainCode = digest.slice(32);

  for (const index of STELLAR_PATH) {
    const data = new Uint8Array(37);
    data[0] = 0;
    data.set(key, 1);
    // SLIP-0010 encodes each derivation index with the hardened high bit set.
    // eslint-disable-next-line no-bitwise
    new DataView(data.buffer).setUint32(33, (index | HARDENED) >>> 0, false);
    digest = hmac(sha512, chainCode, data);
    key = digest.slice(0, 32);
    chainCode = digest.slice(32);
  }

  return key;
}
