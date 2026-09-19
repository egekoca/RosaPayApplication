import {Platform} from 'react-native';

/** The Android emulator reaches the host machine through 10.0.2.2. */
const defaultHost = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

export const apiBaseUrl = process.env.ROSAPAY_API_URL?.trim() || `http://${defaultHost}:4100`;
