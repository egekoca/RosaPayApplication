import {ApiClientError, RosaPayApiClient} from './client';
import {createNativeRosaPaySigner} from '../native/nativeSigner';
import {useAppStore, type ApiSession} from '../state/appStore';

let pendingSession: Promise<ApiSession | null> | null = null;

/** Creates or refreshes the short-lived API session without exporting the device key. */
export async function ensureDeviceSession(
  client: RosaPayApiClient = new RosaPayApiClient({baseUrl: useAppStore.getState().apiBaseUrl}),
): Promise<ApiSession | null> {
  const signer = createNativeRosaPaySigner();
  const identity = await signer.getIdentity();
  if (!identity?.publicKey) throw new Error('No payment key exists on this device');

  const saved = useAppStore.getState().apiSession;
  if (saved?.publicSigner === identity.publicKey && Date.parse(saved.expiresAt) > Date.now() + 30_000) {
    return saved;
  }

  if (!pendingSession) {
    pendingSession = (async () => {
      try {
        const challenge = await client.createDeviceChallenge(identity.publicKey);
        const signed = await signer.signDigest({digest: challenge.challenge, reason: 'Sign in to Lumenade Pay'});
        const session = await client.createDeviceSession({
          challengeId: challenge.challengeId,
          publicSigner: identity.publicKey,
          signature: signed.signature,
        });
        const stored = {...session, publicSigner: identity.publicKey};
        useAppStore.getState().setApiSession(stored);
        return stored;
      } catch (error) {
        if (error instanceof ApiClientError && error.code === 'AUTHENTICATION_DISABLED') return null;
        throw error;
      } finally {
        pendingSession = null;
      }
    })();
  }
  return pendingSession;
}
