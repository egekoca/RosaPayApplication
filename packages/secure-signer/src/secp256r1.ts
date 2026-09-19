/** secp256r1 group order; Soroban rejects signatures whose S is above half of it. */
const CURVE_ORDER = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
const HALF_ORDER = CURVE_ORDER / 2n;

export class Secp256r1FormatError extends Error {
  override readonly name = 'Secp256r1FormatError';
}

/**
 * Platform keystores return ASN.1 DER signatures, while contract accounts verify
 * a fixed 64-byte `r || s`. The S value is also normalized to the low form,
 * which the host requires and hardware does not guarantee.
 */
export function derToCompactSignature(der: Uint8Array): Uint8Array {
  let offset = 0;
  const readByte = () => {
    const value = der[offset];
    if (value === undefined) throw new Secp256r1FormatError('Signature ended before the structure was complete');
    offset += 1;
    return value;
  };

  if (readByte() !== 0x30) throw new Secp256r1FormatError('Signature is not a DER sequence');
  const sequenceLength = readByte();
  if (sequenceLength + 2 !== der.length) {
    throw new Secp256r1FormatError('DER sequence length does not match the signature');
  }

  const readInteger = (): bigint => {
    if (readByte() !== 0x02) throw new Secp256r1FormatError('Expected a DER integer');
    const length = readByte();
    if (length === 0 || offset + length > der.length) {
      throw new Secp256r1FormatError('DER integer length is out of range');
    }
    const bytes = der.subarray(offset, offset + length);
    offset += length;
    return bytes.reduce((total, byte) => (total << 8n) | BigInt(byte), 0n);
  };

  const r = readInteger();
  const s = readInteger();
  if (offset !== der.length) throw new Secp256r1FormatError('DER signature has trailing bytes');
  if (r <= 0n || r >= CURVE_ORDER || s <= 0n || s >= CURVE_ORDER) {
    throw new Secp256r1FormatError('Signature values are outside the curve order');
  }

  const normalizedS = s > HALF_ORDER ? CURVE_ORDER - s : s;
  const compact = new Uint8Array(64);
  compact.set(toFixedBytes(r), 0);
  compact.set(toFixedBytes(normalizedS), 32);
  return compact;
}

/**
 * Extracts the 65-byte uncompressed point from an X.509 SubjectPublicKeyInfo,
 * which is how both platforms export a public key.
 */
export function uncompressedPointFromSpki(spki: Uint8Array): Uint8Array {
  if (spki.length === 65 && spki[0] === 0x04) return spki;
  const marker = spki.lastIndexOf(0x04);
  const point = spki.subarray(spki.length - 65);
  if (point.length !== 65 || point[0] !== 0x04 || marker === -1) {
    throw new Secp256r1FormatError('Public key is not an uncompressed secp256r1 point');
  }
  return point;
}

function toFixedBytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let remaining = value;
  for (let index = 31; index >= 0; index -= 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}
