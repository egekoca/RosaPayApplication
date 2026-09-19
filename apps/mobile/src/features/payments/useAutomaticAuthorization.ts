import {AppState, type AppStateStatus} from 'react-native';
import {useEffect, useRef} from 'react';

export const AUTOMATIC_AUTHORIZATION_DELAY_MS = 700;

/**
 * Starts the device authorization prompt by itself, for a request that arrived
 * by an act that already said what the customer meant.
 *
 * Whether an arrival counts is the caller's to decide, not this hook's. A tap
 * always does: NFC is a few centimetres or nothing. A Bluetooth arrival does
 * only when the signal said the phones were being held together, because a
 * radio reaches across a room and mere presence is not consent. A scan never
 * does — the camera was already a deliberate act, and the approve button is
 * where that flow has always ended.
 *
 * The prompt is not the authorization. The signing key is minted so the
 * hardware refuses to sign without the owner answering it, which is what makes
 * starting it early a convenience rather than a way to spend someone's money.
 */
export function useAutomaticAuthorization(input: {
  intentId: string;
  automatic: boolean;
  ready: boolean;
  authorize(): void;
}): void {
  const attemptedIntent = useRef<string | null>(null);
  const {intentId, automatic, ready, authorize} = input;

  useEffect(() => {
    if (!automatic || !ready || attemptedIntent.current === intentId) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const cancel = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    timer = setTimeout(() => {
      timer = undefined;
      // An arrival may finish while the user backgrounds or locks the app.
      // Never turn that lifecycle transition into a delayed authorization.
      if (cancelled || AppState.currentState !== 'active') return;
      if (attemptedIntent.current === intentId) return;
      attemptedIntent.current = intentId;
      authorize();
    }, AUTOMATIC_AUTHORIZATION_DELAY_MS);

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active') cancel();
    });
    return () => {
      cancelled = true;
      cancel();
      subscription?.remove?.();
    };
  }, [authorize, automatic, intentId, ready]);
}
