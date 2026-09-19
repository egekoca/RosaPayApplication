import {describe, expect, it} from 'vitest';
import {
  credentialIdFromAttestationObject,
  publicKeyFromAttestationObject,
} from '../src/webauthn';

/**
 * A real attestation object, produced by a real Apple platform authenticator.
 *
 * Building fixtures with a CBOR writer of one's own proves only that the writer
 * and the reader agree. This one comes from SimpleWebAuthn's test suite and was
 * made by the platform this code has to work with:
 * https://github.com/MasterKale/SimpleWebAuthn
 * `packages/server/src/registration/verifications/verifyAttestationApple.test.ts`
 */
const APPLE_ATTESTATION =
  'o2NmbXRlYXBwbGVnYXR0U3RtdKJjYWxnJmN4NWOCWQJHMIICQzCCAcmgAwIBAgIGAXSFZw11MAoGCCqGSM49BAMCMEgxHDAa' +
  'BgNVBAMME0FwcGxlIFdlYkF1dGhuIENBIDExEzARBgNVBAoMCkFwcGxlIEluYy4xEzARBgNVBAgMCkNhbGlmb3JuaWEwHhcN' +
  'MjAwOTEzMDI0OTE3WhcNMjAwOTE0MDI1OTE3WjCBkTFJMEcGA1UEAwxAMzI3ZWI1ODhmMTU3ZDZiYjY0NTRmOTdmNWU1NmM4' +
  'NmY0NGI1MDdjODgxOGZmMjMwYmQwZjYyNWJkYjY1YmNiNjEaMBgGA1UECwwRQUFBIENlcnRpZmljYXRpb24xEzARBgNVBAoM' +
  'CkFwcGxlIEluYy4xEzARBgNVBAgMCkNhbGlmb3JuaWEwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARiAlQ11YPbcpjmwM93' +
  'iOefyu00h8-4BALNKnBDB5I9n17wD5wNqP0hYua340eB75Z1L_V6I7R4qraq7763zj9mo1UwUzAMBgNVHRMBAf8EAjAAMA4G' +
  'A1UdDwEB_wQEAwIE8DAzBgkqhkiG92NkCAIEJjAkoSIEIPuwR1EQvcCtYCRahnJWisqz6YYLEAXH16p0WXbLfY6tMAoGCCqG' +
  'SM49BAMCA2gAMGUCMDpEvt_ifVr8uu1rnLykezfrHBXwLL-D6DO73l_sX_DLRwXDmqTiPSx0WHiB554m5AIxAIAXIId3WdSC' +
  '2B2zYFm4ZsJP_jAgjTL1GguZ-Ae78AN2AcjKblEabOdkbKr0aL_M9FkCODCCAjQwggG6oAMCAQICEFYlU5XHp_tA6-Io2CYI' +
  'U7YwCgYIKoZIzj0EAwMwSzEfMB0GA1UEAwwWQXBwbGUgV2ViQXV0aG4gUm9vdCBDQTETMBEGA1UECgwKQXBwbGUgSW5jLjET' +
  'MBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODM4MDFaFw0zMDAzMTMwMDAwMDBaMEgxHDAaBgNVBAMME0FwcGxlIFdl' +
  'YkF1dGhuIENBIDExEzARBgNVBAoMCkFwcGxlIEluYy4xEzARBgNVBAgMCkNhbGlmb3JuaWEwdjAQBgcqhkjOPQIBBgUrgQQA' +
  'IgNiAASDLocvJhSRgQIlufX81rtjeLX1Xz_LBFvHNZk0df1UkETfm_4ZIRdlxpod2gULONRQg0AaQ0-yTREtVsPhz7_LmJH-' +
  'wGlggb75bLx3yI3dr0alruHdUVta-quTvpwLJpGjZjBkMBIGA1UdEwEB_wQIMAYBAf8CAQAwHwYDVR0jBBgwFoAUJtdk2cV4' +
  'wlpn0afeaxLQG2PxxtcwHQYDVR0OBBYEFOuugsT_oaxbUdTPJGEFAL5jvXeIMA4GA1UdDwEB_wQEAwIBBjAKBggqhkjOPQQD' +
  'AwNoADBlAjEA3YsaNIGl-tnbtOdle4QeFEwnt1uHakGGwrFHV1Azcifv5VRFfvZIlQxjLlxIPnDBAjAsimBE3CAfz-' +
  'Wbw00pMMFIeFHZYO1qdfHrSsq-OM0luJfQyAW-8Mf3iwelccboDgdoYXV0aERhdGFYmD3cRxDpwIiyKduonVYyILs59yKa_0' +
  'ZbCmVrGvuaivigRQAAAAAAAAAAAAAAAAAAAAAAAAAAABQniUCo9eF58OtQPuiHktAxsEflMaUBAgMmIAEhWCBiAlQ11YPbcp' +
  'jmwM93iOefyu00h8-4BALNKnBDB5I9nyJYIF7wD5wNqP0hYua340eB75Z1L_V6I7R4qraq7763zj9m';

describe('a real Apple attestation object', () => {
  const attestation = Buffer.from(APPLE_ATTESTATION, 'base64url');

  it('yields the credential public key as an uncompressed P-256 point', () => {
    const point = publicKeyFromAttestationObject(attestation);

    expect(point).toHaveLength(65);
    expect(Buffer.from(point).toString('hex')).toBe(
      '04' +
        '62025435d583db7298e6c0cf7788e79fcaed3487cfb80402cd2a704307923d9f' +
        '5ef00f9c0da8fd2162e6b7e34781ef96752ff57a23b478aab6aaefbeb7ce3f66',
    );
  });

  it('agrees with the key inside the attestation certificate', () => {
    // Apple's attestation statement carries a leaf certificate whose subject
    // public key is the credential public key, encoded as X.509 rather than
    // COSE. The same 65 bytes appearing in both is an independent check that
    // the CBOR walk landed in the right place.
    const point = Buffer.from(publicKeyFromAttestationObject(attestation));
    expect(attestation.includes(point)).toBe(true);
  });

  it('yields the credential id the authenticator assigned', () => {
    const credentialId = credentialIdFromAttestationObject(attestation);
    expect(Buffer.from(credentialId).toString('hex')).toBe('278940a8f5e179f0eb503ee88792d031b047e531');
  });
});
