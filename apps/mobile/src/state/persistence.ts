import * as Keychain from 'react-native-keychain';
import {logger} from '../shared/logger';

const SERVICE = 'com.rosapay.session';
const USERNAME = 'rosapay';

/**
 * Session storage backed by the iOS Keychain and Android Keystore-backed
 * storage. The demo signer secrets live here rather than in plain app storage,
 * so a restored session never leaves key material readable on the device.
 */
export type SessionStorageStatus = {
  state: 'unknown' | 'saved' | 'restored' | 'unavailable';
  detail?: string;
};

let status: SessionStorageStatus = {state: 'unknown'};
const listeners = new Set<(next: SessionStorageStatus) => void>();

/** Whether the session is actually surviving on this device, and why not. */
export function getSessionStorageStatus(): SessionStorageStatus {
  return status;
}

export function subscribeToSessionStorage(listener: (next: SessionStorageStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setStatus(next: SessionStorageStatus): void {
  status = next;
  for (const listener of listeners) listener(next);
}

export const secureSessionStorage = {
  async getItem(): Promise<string | null> {
    try {
      const stored = await Keychain.getGenericPassword({service: SERVICE});
      if (stored !== false) setStatus({state: 'restored'});
      return stored === false ? null : stored.password;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown';
      logger.error('session_read_failed', {message: detail});
      setStatus({state: 'unavailable', detail});
      return null;
    }
  },
  async setItem(_key: string, value: string): Promise<void> {
    try {
      await Keychain.setGenericPassword(USERNAME, value, {service: SERVICE});
      setStatus({state: 'saved'});
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown';
      logger.error('session_write_failed', {message: detail});
      setStatus({state: 'unavailable', detail});
    }
  },
  async removeItem(): Promise<void> {
    try {
      await Keychain.resetGenericPassword({service: SERVICE});
    } catch (error) {
      logger.error('session_clear_failed', {message: error instanceof Error ? error.message : 'unknown'});
    }
  },
};

export type PersistedSecret = {__bytes: string};

/** Byte arrays do not survive JSON, so secrets are stored as hex and restored in place. */
export function encodeSecrets(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return {__bytes: Buffer.from(value).toString('hex')} satisfies PersistedSecret;
  }
  if (Array.isArray(value)) return value.map(encodeSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encodeSecrets(entry)]));
  }
  return value;
}

export function decodeSecrets(value: unknown): unknown {
  if (isPersistedSecret(value)) {
    return Uint8Array.from(Buffer.from(value.__bytes, 'hex'));
  }
  // A JSON reviver runs bottom-up, so a secret restored by an inner call must be
  // left alone here; walking into it would turn the bytes back into an object.
  if (ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) return value.map(decodeSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, decodeSecrets(entry)]));
  }
  return value;
}

function isPersistedSecret(value: unknown): value is PersistedSecret {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__bytes' in value &&
    typeof (value as PersistedSecret).__bytes === 'string' &&
    /^[0-9a-f]*$/i.test((value as PersistedSecret).__bytes)
  );
}
