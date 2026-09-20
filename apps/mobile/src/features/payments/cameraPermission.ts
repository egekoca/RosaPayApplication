import {NativeModules, PermissionsAndroid, Platform, TurboModuleRegistry} from 'react-native';
import type {TurboModule} from 'react-native';

export type CameraPermission = 'granted' | 'denied' | 'unavailable';

interface CameraAuthorization extends TurboModule {
  checkDeviceCameraAuthorizationStatus(): Promise<boolean | number>;
  requestDeviceCameraAuthorization(): Promise<boolean>;
}

/**
 * The camera library's own default export is `NativeModules.CameraKit`, and no
 * such module exists: the class it registers on both platforms is
 * `RNCameraKitModule`. So `import CameraKit from 'react-native-camera-kit'` is
 * `undefined`, every call on it throws, and this file used to read that as "no
 * camera on this device" — on a phone that plainly has one, with no permission
 * prompt ever shown, because there was nothing to ask.
 *
 * Its `.d.ts` types that export as `any`, which is why nothing caught it.
 *
 * Resolved here by the name the native side actually registers, through the
 * TurboModule registry first because this app runs the new architecture, then
 * the legacy bridge for either interop path. Null when genuinely absent, which
 * is the only honest reason to say a device has no camera.
 */
function cameraAuthorization(): CameraAuthorization | null {
  return (
    TurboModuleRegistry.get<CameraAuthorization>('RNCameraKitModule') ??
    (NativeModules.RNCameraKitModule as CameraAuthorization | undefined) ??
    (NativeModules.CameraKit as CameraAuthorization | undefined) ??
    null
  );
}

/**
 * Asks for the camera the way each platform expects.
 *
 * The camera library's Android permission methods are no-ops that never settle
 * their promise, so Android is handled with the platform's own permission API.
 * iOS has a real implementation and is asked through the library.
 */
export async function requestCameraPermission(): Promise<CameraPermission> {
  if (Platform.OS === 'android') {
    try {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
    } catch {
      return 'unavailable';
    }
  }

  const camera = cameraAuthorization();
  if (!camera) return 'unavailable';

  try {
    /*
     * The check answers with three values, not two: `true` for authorized,
     * `false` for denied or restricted, and `-1` for not determined — see
     * CameraManager.checkDeviceCameraAuthorizationStatus in the library.
     *
     * That `-1` is why the camera never opened on a real phone. It was read
     * through `||`, and -1 is truthy in JavaScript, so a fresh install
     * short-circuited to "granted" without ever calling the request — iOS
     * showed no permission prompt at all, the camera view then mounted with no
     * authorization, its own error handler fired, and the screen concluded the
     * device had no camera. On a phone that plainly has one.
     */
    const status = await camera.checkDeviceCameraAuthorizationStatus();
    if (status === true) return 'granted';
    if (status === false) return 'denied';

    // Not determined: this is the one case where asking is the right move, and
    // the prompt only ever appears once per install.
    const granted = await camera.requestDeviceCameraAuthorization();
    return granted === true ? 'granted' : 'denied';
  } catch {
    // Simulators without a virtual camera land here.
    return 'unavailable';
  }
}
