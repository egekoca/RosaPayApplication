import {AppState, type AppStateStatus} from 'react-native';
import {useEffect, useRef} from 'react';
import type {PaymentTransport} from '../../state/appStore';

export const NFC_AUTO_AUTHORIZATION_DELAY_MS = 700;

export function useNfcAutoAuthorization(input: {
  intentId: string;
  transport: PaymentTransport;
  ready: boolean;
  authorize(): void;
}): void {
  const attemptedIntent = useRef<string | null>(null);
  const {intentId, transport, ready, authorize} = input;

  useEffect(() => {
    if (transport !== 'nfc' || !ready || attemptedIntent.current === intentId) return;

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
      // A tap may finish while the user backgrounds or locks the app. Never
      // turn that lifecycle transition into a delayed authorization.
      if (cancelled || AppState.currentState !== 'active') return;
      if (attemptedIntent.current === intentId) return;
      attemptedIntent.current = intentId;
      authorize();
    }, NFC_AUTO_AUTHORIZATION_DELAY_MS);

    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state !== 'active') cancel();
    });
    return () => {
      cancelled = true;
      cancel();
      subscription?.remove?.();
    };
  }, [authorize, intentId, ready, transport]);
}
