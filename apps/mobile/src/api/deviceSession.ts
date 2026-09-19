import {ApiClientError, RosaPayApiClient} from './client';
import {createNativeRosaPaySigner} from '../native/nativeSigner';
import {useAppStore, type ApiSession} from '../state/appStore';

let pendingSession: Promise<ApiSession | null> | null = null;

/** Creates or refreshes the short-lived API session without exporting the device key. */
export async function ensureDeviceSession(
  client: RosaPayApiClient = new RosaPayApiClient({baseUrl: useAppStore.getState().apiBaseUrl}),
): Promise<ApiSession | null> {
  const signer = createNativeRosaPaySigner();
  // Minting it here rather than demanding it is what makes a recovery-phrase
  // account able to get paid. That path never touches the smart wallet, so
  // nothing else would ever create the key this session is signed with, and a
  // merchant who onboarded with twelve words could not register on the
  // contract or publish a request.
  let identity = await signer.getIdentity().catch(() => null);
  if (!identity?.publicKey) {
    // The native layer knows why it cannot mint one - no screen lock, no
    // module - and says so in words worth showing, so let that reason travel
    // rather than replacing it with a guess.
    identity = await signer.createIdentity('Rosa Pay');
  }
  if (!identity?.publicKey) {
    throw new Error('Set a screen lock on this phone so it can hold a payment key, then try again');
  }

  const saved = useAppStore.getState().apiSession;
  if (saved?.publicSigner === identity.publicKey && Date.parse(saved.expiresAt) > Date.now() + 30_000) {
    return saved;
  }

  if (!pendingSession) {
    pendingSession = (async () => {
      try {
        const challenge = await client.createDeviceChallenge(identity.publicKey);
        const signed = await signer.signDigest({digest: challenge.challenge, reason: 'Sign in to Rosa Pay'});
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
