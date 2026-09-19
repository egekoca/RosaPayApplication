/**
 * Must be imported before anything that pulls in the Stellar SDK.
 *
 * The `buffer` polyfill only re-attaches the Buffer prototype in `slice()`, so
 * its `subarray()` returns a plain `Uint8Array` — unlike Node, where `subarray`
 * returns a Buffer. js-xdr reads every XDR string through `subarray().toString('utf8')`,
 * so without this alignment contract method names decode as comma-separated byte
 * codes and the generated client ends up with no callable methods at all.
 */
/*
 * React Native ships no `crypto.getRandomValues`, and everything Rosa Pay
 * signs — a payment nonce, an unlock challenge — needs real entropy. This
 * installs the platform CSPRNG: `SecureRandom` on Android, `SecRandomCopyBytes`
 * on iOS. Importing it is the whole API; it defines the global.
 */
import 'react-native-get-random-values';
import {Buffer} from 'buffer';

type BufferPrototype = {
  subarray: (start?: number, end?: number) => Uint8Array;
};

const globals = globalThis as {Buffer?: typeof Buffer};
if (!globals.Buffer) {
  globals.Buffer = Buffer;
}

const prototype = Buffer.prototype as unknown as BufferPrototype;
const nativeSubarray = prototype.subarray;
if (!(nativeSubarray.call(Buffer.from([1, 2, 3]), 0, 1) instanceof Buffer)) {
  prototype.subarray = function subarray(this: Uint8Array, start?: number, end?: number) {
    const result = nativeSubarray.call(this, start, end);
    Object.setPrototypeOf(result, Buffer.prototype);
    return result;
  };
}

export {};
