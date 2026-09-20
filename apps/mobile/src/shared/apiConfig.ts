import {Platform} from 'react-native';
import {testnetDeployment} from '@rosapay/stellar';

/** The Android emulator reaches the host machine through 10.0.2.2. */
const emulatorHost = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
const developmentApiBaseUrl = `http://${emulatorHost}:4100`;

/**
 * Where the app looks for its API.
 *
 * A build handed to someone else cannot default to a loopback address: that is
 * the phone's own, so a TestFlight or APK install would reach nothing and every
 * person would have to be told to type a URL into developer settings before the
 * app did anything. The deployment manifest carries the hosted address for the
 * same reason it carries the contract id — it is a public fact about where this
 * deployment lives — and the emulator default is only what is left when no
 * deployment has been published.
 *
 * It stays overridable at runtime either way, because a physical phone on a
 * developer's desk still needs to point at that desk.
 */
export const defaultApiBaseUrl =
  typeof testnetDeployment.apiBaseUrl === 'string' && testnetDeployment.apiBaseUrl.trim()
    ? testnetDeployment.apiBaseUrl.trim().replace(/\/+$/, '')
    : developmentApiBaseUrl;

/** Whether this build ships an address other people's phones can reach. */
export const hasHostedApi = defaultApiBaseUrl !== developmentApiBaseUrl;

/**
 * React Native does not populate `process.env` beyond `NODE_ENV`, so a build-time
 * variable would silently do nothing. The API location is a runtime setting
 * instead, which is also what a physical device needs: a phone cannot reach the
 * development machine on localhost, and changing it must not require a rebuild.
 */
export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+(:\d+)?(\/.*)?$/i.test(trimmed)) {
    throw new Error('Enter an address like https://api.example.com');
  }
  return trimmed;
}

export function isReachableFromDevice(url: string): boolean {
  // A phone has its own loopback, so localhost only works on an emulator.
  return !/^https?:\/\/(127\.0\.0\.1|localhost)\b/i.test(url) || Platform.OS !== 'android';
}

/**
 * Whether an address only ever meant anything on a developer's machine.
 *
 * `127.0.0.1` and `localhost` are the phone's own loopback on a real handset,
 * and `10.0.2.2` is the Android emulator's name for the host it is running on.
 * A build installed on a physical phone that points at one of these reaches
 * nothing at all — no merchant can publish a request, no customer can settle —
 * and it does so silently, because the address is perfectly well-formed.
 */
export function isEmulatorOnlyApiBaseUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|10\.0\.2\.2)\b/i.test(url.trim());
}
