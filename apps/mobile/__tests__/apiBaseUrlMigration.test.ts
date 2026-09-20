import {isEmulatorOnlyApiBaseUrl} from '../src/shared/apiConfig';
import {repointStaleApiBaseUrl} from '../src/state/appStore';
import {testnetDeployment} from '@rosapay/stellar';

const hosted = testnetDeployment.apiBaseUrl!;

describe('an install still pointing at a developer’s machine', () => {
  it('knows which addresses only ever meant anything on one', () => {
    expect(isEmulatorOnlyApiBaseUrl('http://127.0.0.1:4100')).toBe(true);
    expect(isEmulatorOnlyApiBaseUrl('http://localhost:4100')).toBe(true);
    // The Android emulator's name for the machine hosting it.
    expect(isEmulatorOnlyApiBaseUrl('http://10.0.2.2:4100')).toBe(true);

    // A real address on a real network, which a developer may well have meant.
    expect(isEmulatorOnlyApiBaseUrl('http://192.168.1.10:4100')).toBe(false);
    expect(isEmulatorOnlyApiBaseUrl(hosted)).toBe(false);
  });

  it('repoints a saved loopback address at the deployment this build ships', () => {
    // The saved address outlives the default that produced it. On a phone,
    // 127.0.0.1 is the phone: no request publishes, no QR appears, nothing
    // settles — and none of it says so, because the address is well formed.
    expect(repointStaleApiBaseUrl({apiBaseUrl: 'http://127.0.0.1:4100'}).apiBaseUrl).toBe(hosted);
    expect(repointStaleApiBaseUrl({apiBaseUrl: 'http://10.0.2.2:4100'}).apiBaseUrl).toBe(hosted);
  });

  it('leaves an address someone deliberately chose alone', () => {
    // A developer pointing a phone at their desk typed a LAN address, and this
    // must not take that away from them.
    expect(repointStaleApiBaseUrl({apiBaseUrl: 'http://192.168.1.10:4100'}).apiBaseUrl).toBe(
      'http://192.168.1.10:4100',
    );
    expect(repointStaleApiBaseUrl({apiBaseUrl: hosted}).apiBaseUrl).toBe(hosted);
  });

  it('touches nothing else it was handed', () => {
    const state = {apiBaseUrl: 'http://localhost:4100', language: 'tr' as const, requireUnlock: true};
    expect(repointStaleApiBaseUrl(state)).toEqual({...state, apiBaseUrl: hosted});
  });
});
