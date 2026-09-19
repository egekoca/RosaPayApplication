import {PermissionsAndroid, Platform} from 'react-native';
import CameraKit from 'react-native-camera-kit';

export type CameraPermission = 'granted' | 'denied' | 'unavailable';

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
    const status = await CameraKit.checkDeviceCameraAuthorizationStatus();
    if (status === true) return 'granted';
    if (status === false) return 'denied';

    // Not determined: this is the one case where asking is the right move, and
    // the prompt only ever appears once per install.
    const granted = await CameraKit.requestDeviceCameraAuthorization();
    return granted === true ? 'granted' : 'denied';
  } catch {
    // Simulators without a virtual camera land here.
    return 'unavailable';
  }
}
