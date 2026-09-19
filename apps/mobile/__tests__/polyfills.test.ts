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
});
