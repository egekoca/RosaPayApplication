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

/**
 * React Native ships no `TextDecoder`, and the Stellar SDK reaches for one
 * whenever it reads a symbol or a string that arrived as bytes — which is every
 * contract struct a phone ever decodes, because a value that has been through
 * XDR keeps its field names as bytes rather than as strings.
 *
 * Its absence did not fail loudly. The SDK wraps that call in a `catch` that
 * returns the raw bytes instead, so field names came back as character codes,
 * every lookup by name found nothing, and an offline payment was refused for
 * an amount that had not changed. Nothing in the test suite saw it: a value
 * built in memory keeps its symbols as strings and never takes that path.
 *
 * UTF-8 only, which is all XDR text and all this app asks for. It defers to a
 * real implementation wherever one exists.
 */
type DecoderInput = ArrayBuffer | ArrayBufferView;

class Utf8TextDecoder {
  readonly encoding = 'utf-8';
  readonly fatal = false;
  readonly ignoreBOM = false;

  decode(input?: DecoderInput): string {
    if (input === undefined) return '';
    // The byte offset and length matter: a view is usually a window onto a much
    // larger buffer, and decoding the whole buffer is the bug this replaces.
    const bytes = ArrayBuffer.isView(input)
      ? Buffer.from(input.buffer, input.byteOffset, input.byteLength)
      : Buffer.from(input);
    return bytes.toString('utf8');
  }
}

const textGlobals = globalThis as {TextDecoder?: unknown};
if (typeof textGlobals.TextDecoder === 'undefined') {
  textGlobals.TextDecoder = Utf8TextDecoder;
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
