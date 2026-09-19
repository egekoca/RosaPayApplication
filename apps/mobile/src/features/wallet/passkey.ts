import {NativeModules} from 'react-native';
import {
  publicKeyFromAttestationObject,
  credentialIdFromAttestationObject,
} from '@rosapay/secure-signer';
import type {PasskeySigner} from '@rosapay/stellar';
import {logger} from '../../shared/logger';

/**
 * The passkey half of this wallet's custody.
 *
 * The Secure Enclave key next to it is bound to one handset by design, which is
 * what makes it safe and also what would make an account die with the phone. A
 * passkey is the same P-256 cryptography with the one difference that matters:
 * iCloud Keychain and Google Password Manager replicate the credential to the
 * owner's other devices, so the account outlives the device that made it.
 *
 * The native modules are deliberately thin. They ask the platform and hand back
 * exactly what it produced; everything that can be got wrong - reading the
 * public key out of a CBOR attestation, the base64url the challenge has to
 * travel in - is done here, where it is tested against a real attestation
 * object rather than a phone.
 */

export type PasskeyNativeModule = {
  isSupported(): Promise<boolean>;
  createCredential(request: {
    challenge: string;
    userId: string;
    name?: string;
    relyingParty?: string;
  }): Promise<{
    credentialId: string;
    attestationObject: string;
    clientDataJSON: string;
  }>;
  assert(request: {challenge: string; credentialId?: string; relyingParty?: string}): Promise<{
    credentialId: string;
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
  }>;
};

export class PasskeyError extends Error {
  override readonly name = 'PasskeyError';

  constructor(
    readonly code:
      | 'UNSUPPORTED'
      | 'USER_CANCELLED'
      | 'NO_CREDENTIAL'
      | 'PASSKEY_FAILED'
      | 'INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
  }
}

/** What this device stores about a passkey. Neither field is a secret. */
export type PasskeyCredential = {
  /** base64url, what a later assertion is scoped to. */
  credentialId: string;
  /** Uncompressed SEC1 point, base64, which is what the wallet registers. */
  publicKey: string;
};

function nativeModule(): PasskeyNativeModule | undefined {
  return (NativeModules as {RosaPayPasskey?: PasskeyNativeModule}).RosaPayPasskey;
}

/** Whether this build and this device can hold a passkey at all. */
export async function passkeysAvailable(module = nativeModule()): Promise<boolean> {
  if (!module) return false;
  try {
    return await module.isSupported();
  } catch {
    return false;
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = globalThis.atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function mapNativeError(error: unknown): PasskeyError {
  const code = (error as {code?: string} | undefined)?.code;
  const message = error instanceof Error ? error.message : 'The passkey request failed';
  switch (code) {
    case 'USER_CANCELLED':
      return new PasskeyError('USER_CANCELLED', 'The prompt was dismissed.');
    case 'NO_CREDENTIAL':
      return new PasskeyError('NO_CREDENTIAL', 'This device holds no passkey for this wallet.');
    case 'UNSUPPORTED':
      return new PasskeyError('UNSUPPORTED', 'This device cannot use passkeys.');
    default:
      return new PasskeyError('PASSKEY_FAILED', message);
  }
}

/**
 * Registers a passkey and reads the public key the wallet will store.
 *
 * The challenge here is not a payment. Registration only proves the credential
 * exists, so a random value is enough - and it must be random rather than
 * fixed, because a reused registration challenge is a replayable ceremony.
 */
export async function createPasskey(
  options: {userId: Uint8Array; name?: string; relyingParty?: string},
  module = nativeModule(),
): Promise<PasskeyCredential> {
  if (!module) throw new PasskeyError('UNSUPPORTED', 'This build has no passkey support.');

  const challenge = new Uint8Array(32);
  globalThis.crypto.getRandomValues(challenge);

  let created;
  try {
    created = await module.createCredential({
      challenge: toBase64Url(challenge),
      userId: toBase64Url(options.userId),
      ...(options.name === undefined ? {} : {name: options.name}),
      ...(options.relyingParty === undefined ? {} : {relyingParty: options.relyingParty}),
    });
  } catch (error) {
    throw mapNativeError(error);
  }

  let publicKey: Uint8Array;
  let attestedCredentialId: Uint8Array;
  try {
    const attestation = fromBase64Url(created.attestationObject);
    publicKey = publicKeyFromAttestationObject(attestation);
    attestedCredentialId = credentialIdFromAttestationObject(attestation);
  } catch (error) {
    throw new PasskeyError(
      'INVALID_RESPONSE',
      error instanceof Error ? error.message : 'The authenticator returned a credential this app cannot read.',
    );
  }

  // The platform reports the credential id twice, in the response and inside
  // the attestation. They disagreeing would mean one of them is not this
  // credential, and an assertion scoped to the wrong id simply never matches.
  if (toBase64Url(attestedCredentialId) !== created.credentialId) {
    throw new PasskeyError(
      'INVALID_RESPONSE',
      'The authenticator reported two different credential ids.',
    );
  }

  logger.info('passkey_created', {credentialId: created.credentialId.slice(0, 8)});
  return {credentialId: created.credentialId, publicKey: toBase64(publicKey)};
}

/**
 * A passkey signer the settlement pipeline can use.
 *
 * The pipeline hands over a 32-byte payload as a base64url challenge; the
 * platform puts it into the client data it builds, and the contract reads it
 * back out. Nothing in between may reshape it.
 */
export function createPasskeySigner(
  credential: PasskeyCredential,
  options: {relyingParty?: string} = {},
  module = nativeModule(),
): PasskeySigner {
  return {
    publicKey: credential.publicKey,
    async assert({challenge}) {
      if (!module) throw new PasskeyError('UNSUPPORTED', 'This build has no passkey support.');
      let asserted;
      try {
        asserted = await module.assert({
          challenge,
          credentialId: credential.credentialId,
          ...(options.relyingParty === undefined ? {} : {relyingParty: options.relyingParty}),
        });
      } catch (error) {
        throw mapNativeError(error);
      }
      // The platform answers in base64url; the rest of the app works in plain
      // base64, so the conversion happens once, here.
      return {
        signature: toBase64(fromBase64Url(asserted.signature)),
        authenticatorData: toBase64(fromBase64Url(asserted.authenticatorData)),
        clientDataJSON: toBase64(fromBase64Url(asserted.clientDataJSON)),
      };
    },
  };
}
