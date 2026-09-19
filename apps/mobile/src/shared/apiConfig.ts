import {Platform} from 'react-native';

/** The Android emulator reaches the host machine through 10.0.2.2. */
const defaultHost = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

export const defaultApiBaseUrl = `http://${defaultHost}:4100`;

/**
 * React Native does not populate `process.env` beyond `NODE_ENV`, so a build-time
 * variable would silently do nothing. The API location is a runtime setting
 * instead, which is also what a physical device needs: a phone cannot reach the
 * development machine on localhost, and changing it must not require a rebuild.
 */
export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+(:\d+)?(\/.*)?$/i.test(trimmed)) {
    throw new Error('Enter an address like http://192.168.1.10:4100');
  }
  return trimmed;
}

export function isReachableFromDevice(url: string): boolean {
  // A phone has its own loopback, so localhost only works on an emulator.
  return !/^https?:\/\/(127\.0\.0\.1|localhost)\b/i.test(url) || Platform.OS !== 'android';
}
