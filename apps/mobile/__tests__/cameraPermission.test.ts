import {NativeModules, PermissionsAndroid, Platform, TurboModuleRegistry} from 'react-native';
import {requestCameraPermission} from '../src/features/payments/cameraPermission';

/**
 * Mocked as the native side registers it, not as the library's own `index.js`
 * reads it. That gap is the bug this file exists to hold shut: the library
 * exports `NativeModules.CameraKit`, nothing has ever registered that name, and
 * a test that mocked the library's export was green while a real phone reported
 * having no camera and never showed a permission prompt.
 */
const kit = {
  checkDeviceCameraAuthorizationStatus: jest.fn(),
  requestDeviceCameraAuthorization: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
  delete (NativeModules as Record<string, unknown>).RNCameraKitModule;
  delete (NativeModules as Record<string, unknown>).CameraKit;
  jest
    .spyOn(TurboModuleRegistry, 'get')
    .mockImplementation(name => (name === 'RNCameraKitModule' ? (kit as never) : null));
});

afterEach(() => {
  jest.restoreAllMocks();
});

/**
 * The library answers this check with three values, not two: `true`,
 * `false`, and `-1` for "not determined yet".
 */
describe('asking iOS for the camera', () => {
  it('asks for permission when it has never been asked', async () => {
    // -1 is the library's "not determined". It used to be read through `||`,
    // and -1 is truthy, so a fresh install short-circuited to granted without
    // ever prompting: iOS showed nothing, the camera view mounted
    // unauthorized, and the screen reported a phone with a camera as having
    // none. This is the regression guard for that.
    kit.checkDeviceCameraAuthorizationStatus.mockResolvedValue(-1);
    kit.requestDeviceCameraAuthorization.mockResolvedValue(true);

    await expect(requestCameraPermission()).resolves.toBe('granted');
    expect(kit.requestDeviceCameraAuthorization).toHaveBeenCalledTimes(1);
  });

  it('reports denied when the person refuses the prompt', async () => {
    kit.checkDeviceCameraAuthorizationStatus.mockResolvedValue(-1);
    kit.requestDeviceCameraAuthorization.mockResolvedValue(false);

    await expect(requestCameraPermission()).resolves.toBe('denied');
  });

  it('does not prompt again once permission is held', async () => {
    kit.checkDeviceCameraAuthorizationStatus.mockResolvedValue(true);

    await expect(requestCameraPermission()).resolves.toBe('granted');
    // The prompt appears once per install; asking again would be a no-op that
    // reads as a bug.
    expect(kit.requestDeviceCameraAuthorization).not.toHaveBeenCalled();
  });

  it('does not prompt again once permission is refused', async () => {
    kit.checkDeviceCameraAuthorizationStatus.mockResolvedValue(false);

    await expect(requestCameraPermission()).resolves.toBe('denied');
    // iOS will not show the prompt a second time, so asking would answer
    // "denied" while making the screen look like it was still deciding.
    expect(kit.requestDeviceCameraAuthorization).not.toHaveBeenCalled();
  });

  it('calls a thrown check unavailable, which is what a simulator is', async () => {
    kit.checkDeviceCameraAuthorizationStatus.mockRejectedValue(new Error('no camera'));

    await expect(requestCameraPermission()).resolves.toBe('unavailable');
  });

  it('goes through the platform API on Android, not the library', async () => {
    Platform.OS = 'android';
    const request = jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

    await expect(requestCameraPermission()).resolves.toBe('granted');
    // The library's Android permission methods never settle their promise.
    expect(request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.CAMERA);
    expect(kit.checkDeviceCameraAuthorizationStatus).not.toHaveBeenCalled();
  });

  it('finds the camera under the name the native side actually registers', async () => {
    // The whole failure in one test. `react-native-camera-kit` reads
    // `NativeModules.CameraKit`; both platforms register `RNCameraKitModule`.
    // Reading the library's name gets undefined, every call throws, and the
    // catch below turned that into "no camera on this device".
    jest.spyOn(TurboModuleRegistry, 'get').mockReturnValue(null as never);
    (NativeModules as Record<string, unknown>).RNCameraKitModule = kit;
    kit.checkDeviceCameraAuthorizationStatus.mockResolvedValue(-1);
    kit.requestDeviceCameraAuthorization.mockResolvedValue(true);

    await expect(requestCameraPermission()).resolves.toBe('granted');
    expect(kit.requestDeviceCameraAuthorization).toHaveBeenCalledTimes(1);
  });

  it('says unavailable when no camera module is registered at all', async () => {
    // Genuinely absent is the only honest reason to tell someone their phone
    // has no camera, and it must not be a crash either.
    jest.spyOn(TurboModuleRegistry, 'get').mockReturnValue(null as never);

    await expect(requestCameraPermission()).resolves.toBe('unavailable');
    expect(kit.checkDeviceCameraAuthorizationStatus).not.toHaveBeenCalled();
  });
});
