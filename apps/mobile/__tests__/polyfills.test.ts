import {Buffer} from 'buffer';
import '../src/shared/polyfills';

describe('buffer polyfill alignment', () => {
  it('keeps subarray results usable as Buffers so XDR strings decode', () => {
    const source = Buffer.from('settle_payment', 'utf8');
    const slice = source.subarray(0, source.length);

    expect(slice).toBeInstanceOf(Buffer);
    expect(slice.toString('utf8')).toBe('settle_payment');
  });

  it('installs the Buffer global for the Stellar SDK', () => {
    expect((globalThis as {Buffer?: unknown}).Buffer).toBeDefined();
  });

  it('installs a UTF-8 TextDecoder where the runtime has none', () => {
    /*
     * React Native ships none, and the Stellar SDK reaches for one to read the
     * field names of any contract struct that arrived as bytes. Its own
     * fallback is a `catch` returning the raw bytes, so its absence read as a
     * payment whose every field was missing — which reached a customer as the
     * merchant having changed the amount.
     */
    const real = (globalThis as {TextDecoder?: unknown}).TextDecoder;
    // @ts-expect-error - standing in for React Native
    delete globalThis.TextDecoder;
    jest.resetModules();
    try {
      require('../src/shared/polyfills');
      const Decoder = (globalThis as {TextDecoder?: new () => {decode(input?: unknown): string}})
        .TextDecoder!;
      expect(Decoder).toBeDefined();
      expect(new Decoder().decode(Buffer.from('settle_payment', 'utf8'))).toBe('settle_payment');
      expect(new Decoder().decode()).toBe('');
    } finally {
      (globalThis as {TextDecoder?: unknown}).TextDecoder = real;
    }
  });

  it('decodes only the window a view actually covers', () => {
    // A symbol is almost always a few bytes inside a much larger buffer, and
    // decoding the whole buffer instead is the shape of the bug being replaced.
    const real = (globalThis as {TextDecoder?: unknown}).TextDecoder;
    // @ts-expect-error - standing in for React Native
    delete globalThis.TextDecoder;
    jest.resetModules();
    try {
      require('../src/shared/polyfills');
      const Decoder = (globalThis as {TextDecoder?: new () => {decode(input?: unknown): string}})
        .TextDecoder!;
      const backing = Buffer.from('xxxxamountxxxx', 'utf8');
      const window = new Uint8Array(backing.buffer, backing.byteOffset + 4, 6);
      expect(new Decoder().decode(window)).toBe('amount');
    } finally {
      (globalThis as {TextDecoder?: unknown}).TextDecoder = real;
    }
  });
});
