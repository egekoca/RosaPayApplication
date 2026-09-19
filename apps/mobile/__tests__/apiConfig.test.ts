import {Platform} from 'react-native';
import {defaultApiBaseUrl, isReachableFromDevice, normalizeApiBaseUrl} from '../src/shared/apiConfig';

describe('API address', () => {
  it('defaults to a host the emulator can reach', () => {
    expect(defaultApiBaseUrl).toBe(Platform.OS === 'android' ? 'http://10.0.2.2:4100' : 'http://127.0.0.1:4100');
  });

  it('accepts a development machine on the local network', () => {
    expect(normalizeApiBaseUrl(' http://192.168.1.10:4100/ ')).toBe('http://192.168.1.10:4100');
    expect(normalizeApiBaseUrl('https://api.rosapay.example')).toBe('https://api.rosapay.example');
  });

  it('rejects an address the app cannot call', () => {
    expect(() => normalizeApiBaseUrl('192.168.1.10:4100')).toThrow('Enter an address like');
    expect(() => normalizeApiBaseUrl('ftp://host')).toThrow();
    expect(() => normalizeApiBaseUrl('')).toThrow();
  });

  it('warns that a phone cannot reach the computer on localhost', () => {
    expect(isReachableFromDevice('http://192.168.1.10:4100')).toBe(true);
    expect(isReachableFromDevice('http://127.0.0.1:4100')).toBe(Platform.OS !== 'android');
  });
});
