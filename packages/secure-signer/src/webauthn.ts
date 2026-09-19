/**
 * Reading a passkey's public key out of what the platform hands back.
 *
 * Registering a passkey does not return a public key in any convenient form. It
 * returns an *attestation object*: CBOR, wrapping authenticator data, wrapping
 * the credential's public key as a COSE key. iOS and Android both hand back the
 * same bytes, so this is written once here rather than twice in Swift and
 * Kotlin - and it can be tested without a phone, which is the part that matters
 * given the rest of the passkey path cannot be.
 *
 * ```text
 * attestationObject (CBOR map)
 *   └─ "authData" (bytes)
 *        ├─ 32  rpIdHash
 *        ├─  1  flags            bit 6 set means the next part is present
 *        ├─  4  signCount
 *        └─ attestedCredentialData
 *             ├─ 16  aaguid
 *             ├─  2  credentialIdLength
 *             ├─  …  credentialId
 *             └─ credentialPublicKey (COSE_Key, CBOR)
 *                  -2 → x (32 bytes)
 *                  -3 → y (32 bytes)
 * ```
 *
 * The wallet contract wants the uncompressed SEC1 point, `0x04 || x || y`.
 */

export class WebAuthnFormatError extends Error {
  override readonly name = 'WebAuthnFormatError';
}

/** Set when the authenticator included the credential's public key. */
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;

const COSE_KEY_TYPE = 1;
const COSE_ALGORITHM = 3;
const COSE_CURVE = -1;
const COSE_X = -2;
const COSE_Y = -3;

const KEY_TYPE_EC2 = 2;
const ALGORITHM_ES256 = -7;
const CURVE_P256 = 1;

type CborValue = number | Uint8Array | string | boolean | null | CborValue[] | Map<CborValue, CborValue>;

/**
 * Just enough CBOR to read an attestation object.
 *
 * Deliberately partial: indefinite-length items, tags, floats and big integers
 * cannot appear in this structure, and refusing them is safer than guessing at
 * a meaning. Anything unexpected is a refusal, never a best effort.
 */
class CborReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get consumed(): number {
    return this.offset;
  }

  private byte(): number {
    const value = this.bytes[this.offset];
    if (value === undefined) throw new WebAuthnFormatError('CBOR ended in the middle of a value');
    this.offset += 1;
    return value;
  }

  private take(length: number): Uint8Array {
    if (length < 0 || this.offset + length > this.bytes.length) {
      throw new WebAuthnFormatError('CBOR item runs past the end of the data');
    }
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  /** The argument encoded in the low five bits of the initial byte. */
  private argument(info: number): number {
    if (info < 24) return info;
    if (info === 24) return this.byte();
    if (info === 25) return (this.byte() << 8) | this.byte();
    if (info === 26) {
      // Assembled through multiplication rather than shifts: a 32-bit length
      // with the top bit set would go negative under `<<`.
      return ((this.byte() << 16) | (this.byte() << 8) | this.byte()) * 256 + this.byte();
    }
    throw new WebAuthnFormatError('CBOR value is longer than this reader supports');
  }

  read(): CborValue {
    const initial = this.byte();
    const major = initial >> 5;
    const info = initial & 0x1f;

    switch (major) {
      case 0:
        return this.argument(info);
      case 1:
        return -1 - this.argument(info);
      case 2:
        return this.take(this.argument(info));
      case 3:
        return new TextDecoder().decode(this.take(this.argument(info)));
      case 4: {
        const length = this.argument(info);
        const items: CborValue[] = [];
        for (let index = 0; index < length; index += 1) items.push(this.read());
        return items;
      }
      case 5: {
        const length = this.argument(info);
        const entries = new Map<CborValue, CborValue>();
        for (let index = 0; index < length; index += 1) {
          const key = this.read();
          entries.set(typeof key === 'number' || typeof key === 'string' ? key : String(key), this.read());
        }
        return entries;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        throw new WebAuthnFormatError('CBOR simple value is not one this reader accepts');
      default:
        throw new WebAuthnFormatError('CBOR major type is not one this reader accepts');
    }
  }
}

function expectBytes(value: CborValue | undefined, length: number, label: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new WebAuthnFormatError(`${label} is not a byte string`);
  if (value.length !== length) {
    throw new WebAuthnFormatError(`${label} is ${value.length} bytes rather than ${length}`);
  }
  return value;
}

/** The authenticator data inside an attestation object, still packed. */
export function authenticatorDataFromAttestation(attestationObject: Uint8Array): Uint8Array {
  const decoded = new CborReader(attestationObject).read();
  if (!(decoded instanceof Map)) {
    throw new WebAuthnFormatError('An attestation object is a CBOR map');
  }
  const authData = decoded.get('authData');
  if (!(authData instanceof Uint8Array)) {
    throw new WebAuthnFormatError('The attestation object carries no authenticator data');
  }
  return authData;
}

/**
 * The credential's public key as the uncompressed point the contract stores.
 *
 * Every field the COSE key declares about itself is checked rather than
 * assumed. A credential on another curve, or for another algorithm, would
 * produce 65 bytes that look like a key and verify nothing.
 */
export function publicKeyFromAttestationObject(attestationObject: Uint8Array): Uint8Array {
  const authData = authenticatorDataFromAttestation(attestationObject);
  if (authData.length < 37) {
    throw new WebAuthnFormatError('Authenticator data is too short to describe a credential');
  }

  const flags = authData[32]!;
  if ((flags & FLAG_ATTESTED_CREDENTIAL_DATA) === 0) {
    throw new WebAuthnFormatError('The authenticator returned no credential public key');
  }

  // 32 rpIdHash + 1 flags + 4 signCount, then 16 aaguid, then the id length.
  const credentialIdLength = (authData[53]! << 8) | authData[54]!;
  const keyStart = 55 + credentialIdLength;
  if (keyStart > authData.length) {
    throw new WebAuthnFormatError('The credential id runs past the end of the authenticator data');
  }

  const key = new CborReader(authData.subarray(keyStart)).read();
  if (!(key instanceof Map)) throw new WebAuthnFormatError('The credential public key is not a COSE key');

  if (key.get(COSE_KEY_TYPE) !== KEY_TYPE_EC2) {
    throw new WebAuthnFormatError('The credential public key is not an elliptic-curve key');
  }
  if (key.get(COSE_ALGORITHM) !== ALGORITHM_ES256) {
    throw new WebAuthnFormatError('The credential does not sign with ES256');
  }
  if (key.get(COSE_CURVE) !== CURVE_P256) {
    throw new WebAuthnFormatError('The credential is not on the P-256 curve');
  }

  const x = expectBytes(key.get(COSE_X), 32, 'The credential public key x coordinate');
  const y = expectBytes(key.get(COSE_Y), 32, 'The credential public key y coordinate');

  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(x, 1);
  point.set(y, 33);
  return point;
}

/**
 * The credential id, which is what a later assertion is scoped to.
 *
 * Both platforms also return this alongside the attestation, so this exists for
 * the case where only the attestation object survived - and as a check that the
 * two agree.
 */
export function credentialIdFromAttestationObject(attestationObject: Uint8Array): Uint8Array {
  const authData = authenticatorDataFromAttestation(attestationObject);
  if (authData.length < 55 || (authData[32]! & FLAG_ATTESTED_CREDENTIAL_DATA) === 0) {
    throw new WebAuthnFormatError('The authenticator returned no credential id');
  }
  const credentialIdLength = (authData[53]! << 8) | authData[54]!;
  if (55 + credentialIdLength > authData.length) {
    throw new WebAuthnFormatError('The credential id runs past the end of the authenticator data');
  }
  return authData.subarray(55, 55 + credentialIdLength);
}
