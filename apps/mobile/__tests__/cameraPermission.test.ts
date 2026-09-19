import {PermissionsAndroid, Platform} from 'react-native';
import CameraKit from 'react-native-camera-kit';
import {requestCameraPermission} from '../src/features/payments/cameraPermission';

jest.mock('react-native-camera-kit', () => ({
  __esModule: true,
  default: {
    checkDeviceCameraAuthorizationStatus: jest.fn(),
    requestDeviceCameraAuthorization: jest.fn(),
  },
}));

const kit = CameraKit as unknown as {
  checkDeviceCameraAuthorizationStatus: jest.Mock;
  requestDeviceCameraAuthorization: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = 'ios';
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
});
