import {describe, expect, it} from 'vitest';
import {
  WebAuthnFormatError,
  authenticatorDataFromAttestation,
  credentialIdFromAttestationObject,
  publicKeyFromAttestationObject,
} from '../src/webauthn';

/** Minimal CBOR writer, so the fixtures are built rather than pasted. */
function cborHead(major: number, argument: number): number[] {
  if (argument < 24) return [(major << 5) | argument];
  if (argument < 0x100) return [(major << 5) | 24, argument];
  if (argument < 0x10000) return [(major << 5) | 25, argument >> 8, argument & 0xff];
  return [
    (major << 5) | 26,
    (argument >>> 24) & 0xff,
    (argument >> 16) & 0xff,
    (argument >> 8) & 0xff,
    argument & 0xff,
  ];
}

const bytes = (value: Uint8Array) => [...cborHead(2, value.length), ...value];
const text = (value: string) => [...cborHead(3, value.length), ...new TextEncoder().encode(value)];
const unsigned = (value: number) => cborHead(0, value);
const negative = (value: number) => cborHead(1, -1 - value);

function coseKey({
  x = new Uint8Array(32).fill(1),
  y = new Uint8Array(32).fill(2),
  keyType = 2,
  algorithm = -7,
  curve = 1,
}: {x?: Uint8Array; y?: Uint8Array; keyType?: number; algorithm?: number; curve?: number} = {}): number[] {
  return [
    ...cborHead(5, 5),
    ...unsigned(1),
    ...unsigned(keyType),
    ...unsigned(3),
    ...(algorithm < 0 ? negative(algorithm) : unsigned(algorithm)),
    ...negative(-1),
    ...unsigned(curve),
    ...negative(-2),
    ...bytes(x),
    ...negative(-3),
    ...bytes(y),
  ];
}

const AT = 0x40;
const UP_UV = 0x01 | 0x04;

function authenticatorData({
  flags = AT | UP_UV,
  credentialId = new Uint8Array(16).fill(9),
  key = coseKey(),
}: {flags?: number; credentialId?: Uint8Array; key?: number[]} = {}): Uint8Array {
  return Uint8Array.from([
    ...new Uint8Array(32).fill(0x49), // rpIdHash
    flags,
    0,
    0,
    0,
    1, // signCount
    ...new Uint8Array(16), // aaguid
    (credentialId.length >> 8) & 0xff,
    credentialId.length & 0xff,
    ...credentialId,
    ...key,
  ]);
}

function attestationObject(authData: Uint8Array = authenticatorData()): Uint8Array {
  return Uint8Array.from([
    ...cborHead(5, 3),
    ...text('fmt'),
    ...text('none'),
    ...text('attStmt'),
    ...cborHead(5, 0),
    ...text('authData'),
    ...bytes(authData),
  ]);
}

describe('reading a passkey out of an attestation object', () => {
  it('returns the uncompressed point the wallet contract stores', () => {
    const x = new Uint8Array(32).fill(0xaa);
    const y = new Uint8Array(32).fill(0xbb);
    const point = publicKeyFromAttestationObject(attestationObject(authenticatorData({key: coseKey({x, y})})));

    expect(point).toHaveLength(65);
    expect(point[0]).toBe(0x04);
    expect(point.subarray(1, 33)).toEqual(x);
    expect(point.subarray(33)).toEqual(y);
  });

  it('finds the key after a credential id of any length', () => {
    for (const length of [1, 16, 32, 64, 300]) {
      const credentialId = new Uint8Array(length).fill(7);
      const point = publicKeyFromAttestationObject(
        attestationObject(authenticatorData({credentialId})),
      );
      expect(point).toHaveLength(65);
      expect(credentialIdFromAttestationObject(attestationObject(authenticatorData({credentialId})))).toEqual(
        credentialId,
      );
    }
  });

  it('reads the authenticator data back unchanged', () => {
    const authData = authenticatorData();
    expect(authenticatorDataFromAttestation(attestationObject(authData))).toEqual(authData);
  });

  it('refuses a key on another curve, for another algorithm, or of another type', () => {
    expect(() =>
      publicKeyFromAttestationObject(attestationObject(authenticatorData({key: coseKey({curve: 2})}))),
    ).toThrow(/P-256/);
    expect(() =>
      publicKeyFromAttestationObject(attestationObject(authenticatorData({key: coseKey({algorithm: -257})}))),
    ).toThrow(/ES256/);
    expect(() =>
      publicKeyFromAttestationObject(attestationObject(authenticatorData({key: coseKey({keyType: 3})}))),
    ).toThrow(/elliptic-curve/);
  });

  it('refuses coordinates that are not 32 bytes', () => {
    expect(() =>
      publicKeyFromAttestationObject(
        attestationObject(authenticatorData({key: coseKey({x: new Uint8Array(31)})})),
      ),
    ).toThrow(WebAuthnFormatError);
  });

  it('refuses an assertion-shaped authenticator data with no credential in it', () => {
    const withoutCredential = Uint8Array.from([
      ...new Uint8Array(32).fill(0x49),
      UP_UV, // the attested-credential-data bit is clear
      0,
      0,
      0,
      1,
    ]);
    expect(() => publicKeyFromAttestationObject(attestationObject(withoutCredential))).toThrow(
      /no credential public key/,
    );
  });

  it('refuses a credential id that runs past the end of the data', () => {
    const authData = authenticatorData();
    // Claim a credential id far longer than what follows.
    authData[53] = 0xff;
    authData[54] = 0xff;
    expect(() => publicKeyFromAttestationObject(attestationObject(authData))).toThrow(/runs past the end/);
  });

  it('refuses something that is not an attestation object at all', () => {
    expect(() => publicKeyFromAttestationObject(Uint8Array.from([0x00]))).toThrow(WebAuthnFormatError);
    expect(() => publicKeyFromAttestationObject(new Uint8Array(0))).toThrow(WebAuthnFormatError);
    expect(() =>
      publicKeyFromAttestationObject(Uint8Array.from([...cborHead(5, 1), ...text('fmt'), ...text('none')])),
    ).toThrow(/no authenticator data/);
  });

  it('refuses truncated data rather than reading past it', () => {
    const full = attestationObject();
    for (const cut of [1, 5, full.length - 1]) {
      expect(() => publicKeyFromAttestationObject(full.subarray(0, cut))).toThrow(WebAuthnFormatError);
    }
  });
});
