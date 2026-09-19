import {p256} from '@noble/curves/nist.js';
import {describe, expect, it} from 'vitest';
import {derToCompactSignature, Secp256r1FormatError, uncompressedPointFromSpki} from '../src/secp256r1';

const CURVE_ORDER = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');

function toDer(r: bigint, s: bigint): Uint8Array {
  const encodeInteger = (value: bigint) => {
    let hex = value.toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    let bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
    // DER integers are signed, so a high bit needs a leading zero.
    if ((bytes[0] ?? 0) & 0x80) bytes = Uint8Array.from([0, ...bytes]);
    return Uint8Array.from([0x02, bytes.length, ...bytes]);
  };
  const body = Uint8Array.from([...encodeInteger(r), ...encodeInteger(s)]);
  return Uint8Array.from([0x30, body.length, ...body]);
}

describe('platform signature conversion', () => {
  it('converts a keystore DER signature into the 64-byte form the contract verifies', () => {
    const secretKey = p256.utils.randomSecretKey();
    const digest = Uint8Array.from(Buffer.alloc(32, 5));
    const signature = p256.sign(digest, secretKey, {prehash: false, lowS: true});
    const compactFromCurve = signature;
    const converted = derToCompactSignature(
      toDer(
        BigInt(`0x${Buffer.from(compactFromCurve.subarray(0, 32)).toString('hex')}`),
        BigInt(`0x${Buffer.from(compactFromCurve.subarray(32)).toString('hex')}`),
      ),
    );

    expect(converted).toHaveLength(64);
    expect(Buffer.from(converted).toString('hex')).toBe(Buffer.from(compactFromCurve).toString('hex'));
    expect(p256.verify(converted, digest, p256.getPublicKey(secretKey, false), {prehash: false})).toBe(true);
  });

  it('normalizes a high-S signature, which hardware does not guarantee', () => {
    const secretKey = p256.utils.randomSecretKey();
    const digest = Uint8Array.from(Buffer.alloc(32, 9));
    const signature = p256.sign(digest, secretKey, {prehash: false, lowS: true});
    const compact = signature;
    const r = BigInt(`0x${Buffer.from(compact.subarray(0, 32)).toString('hex')}`);
    const lowS = BigInt(`0x${Buffer.from(compact.subarray(32)).toString('hex')}`);
    const highS = CURVE_ORDER - lowS;

    const converted = derToCompactSignature(toDer(r, highS));

    expect(Buffer.from(converted.subarray(32)).toString('hex')).toBe(lowS.toString(16).padStart(64, '0'));
    expect(p256.verify(converted, digest, p256.getPublicKey(secretKey, false), {prehash: false})).toBe(true);
  });

  it('rejects a malformed DER structure instead of producing garbage', () => {
    expect(() => derToCompactSignature(Uint8Array.from([0x31, 0x02, 0x02, 0x00]))).toThrow(Secp256r1FormatError);
    expect(() => derToCompactSignature(Uint8Array.from([0x30, 0x10, 0x02, 0x01, 0x01]))).toThrow(Secp256r1FormatError);
    expect(() => derToCompactSignature(toDer(0n, 1n))).toThrow('outside the curve order');
  });

  it('reads the uncompressed point out of an exported public key', () => {
    const point = p256.getPublicKey(p256.utils.randomSecretKey(), false);
    const spki = Uint8Array.from([...Buffer.alloc(26, 0x30), ...point]);

    expect(Buffer.from(uncompressedPointFromSpki(spki)).toString('hex')).toBe(Buffer.from(point).toString('hex'));
    expect(Buffer.from(uncompressedPointFromSpki(point)).toString('hex')).toBe(Buffer.from(point).toString('hex'));
    expect(() => uncompressedPointFromSpki(Uint8Array.from([1, 2, 3]))).toThrow(Secp256r1FormatError);
  });
});
