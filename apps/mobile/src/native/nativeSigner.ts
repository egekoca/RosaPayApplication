import {NativeModules} from 'react-native';
import {
  NativeSecureSigner,
  SecureSignerError,
  type NativeSignerBridge,
  type SecureSignerErrorCode,
} from '@rosapay/secure-signer';

type NativeSignerModule = NativeSignerBridge & {
  deleteIdentity(): Promise<void>;
  signTransaction(request: Parameters<NonNullable<NativeSignerBridge['signTransaction']>>[0]): ReturnType<NonNullable<NativeSignerBridge['signTransaction']>>;
  signAuthEntry(request: Parameters<NonNullable<NativeSignerBridge['signAuthEntry']>>[0]): ReturnType<NonNullable<NativeSignerBridge['signAuthEntry']>>;
  signDigest(request: Parameters<NonNullable<NativeSignerBridge['signDigest']>>[0]): ReturnType<NonNullable<NativeSignerBridge['signDigest']>>;
};

const errorCodes: SecureSignerErrorCode[] = [
  'UNAVAILABLE',
  'USER_CANCELLED',
  'BIOMETRIC_FAILED',
  'LOCKED_OUT',
  'PROCESS_INTERRUPTED',
  'INVALID_REQUEST',
];

function normalizeError(error: unknown): SecureSignerError {
  const candidate = error as {code?: unknown; message?: unknown};
  const code = typeof candidate?.code === 'string' && errorCodes.includes(candidate.code as SecureSignerErrorCode)
    ? candidate.code as SecureSignerErrorCode
    : 'UNAVAILABLE';
  const message = typeof candidate?.message === 'string' ? candidate.message : 'Native signer is unavailable';
  return new SecureSignerError(code, message);
}

function unavailable<T>(): Promise<T> {
  return Promise.reject(new SecureSignerError('UNAVAILABLE', 'RosaPaySigner native module is unavailable'));
}

export function createNativeRosaPaySigner(nativeModule: NativeSignerModule | null = NativeModules.RosaPaySigner): NativeSecureSigner {
  const bridge: NativeSignerBridge = {
    getIdentity: () => nativeModule?.getIdentity?.().catch(error => Promise.reject(normalizeError(error))) ?? unavailable(),
    createIdentity: displayName => nativeModule?.createIdentity?.(displayName).catch(error => Promise.reject(normalizeError(error))) ?? unavailable(),
    deleteIdentity: () => nativeModule?.deleteIdentity?.().catch(error => Promise.reject(normalizeError(error))) ?? unavailable(),
    authorizePayment: request => nativeModule?.authorizePayment?.(request).catch(error => Promise.reject(normalizeError(error))) ?? unavailable(),
    signTransaction: request => nativeModule?.signTransaction?.(request).catch(error => Promise.reject(normalizeError(error))) ?? unavailable(),
    signAuthEntry: request => nativeModule?.signAuthEntry?.(request).catch(error => Promise.reject(normalizeError(error))) ?? unavailable(),
    signDigest: request => nativeModule?.signDigest?.(request).catch(error => Promise.reject(normalizeError(error))) ?? unavailable(),
  };
  return new NativeSecureSigner(bridge);
}
