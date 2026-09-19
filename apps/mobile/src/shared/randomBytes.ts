import type {RandomBytes} from '@rosapay/protocol';
import {logger} from './logger';

export class RandomnessUnavailableError extends Error {
  override readonly name = 'RandomnessUnavailableError';
}

type WebCryptoLike = {getRandomValues?<T extends ArrayBufferView>(array: T): T};

function webCrypto(): WebCryptoLike | undefined {
  return (globalThis as {crypto?: WebCryptoLike}).crypto;
}

/** True when the platform exposes a real CSPRNG (browser, Node, or an RN polyfill). */
export function hasSecureRandomness(): boolean {
  return typeof webCrypto()?.getRandomValues === 'function';
}

/**
 * `polyfills.ts` installs the platform CSPRNG, so `getRandomValues` is there on
 * both platforms. This still refuses rather than inventing entropy when it is
 * missing — a bundle that failed to load the polyfill must fail loudly, not sign
 * a real payment with `Math.random`.
 */
export function createRandomBytes({allowInsecureFallback}: {allowInsecureFallback: boolean}): RandomBytes {
  return size => {
    const crypto = webCrypto();
    if (typeof crypto?.getRandomValues === 'function') {
      return crypto.getRandomValues(new Uint8Array(size));
    }
    if (!allowInsecureFallback) {
      throw new RandomnessUnavailableError(
        'This device has no secure randomness source; install a native CSPRNG before signing real payments',
      );
    }

    logger.info('insecure_randomness_used', {size, reason: 'explicitly_allowed'});
    const bytes = new Uint8Array(size);
    for (let index = 0; index < size; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
    return bytes;
  };
}
