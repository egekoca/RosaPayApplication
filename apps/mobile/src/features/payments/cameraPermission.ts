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
    const granted =
      (await CameraKit.checkDeviceCameraAuthorizationStatus()) ||
      (await CameraKit.requestDeviceCameraAuthorization());
    return granted ? 'granted' : 'denied';
  } catch {
    // Simulators without a virtual camera land here.
    return 'unavailable';
  }
}
