import {useEffect, useState} from 'react';
import {AppState, type AppStateStatus} from 'react-native';

/**
 * Whether the app has actually gone away, rather than merely being covered.
 *
 * iOS reports `inactive` for everything that puts system UI in front: a Core
 * NFC reader sheet, a permission alert, a biometric prompt, Control Centre, the
 * app switcher, an incoming call. Only `background` means the app is no longer
 * the one someone is using.
 *
 * Reading `inactive` as "gone" is not a small mistake here, because the system
 * sheet *is* the feature. Arming the NFC reader made iOS present its sheet,
 * which resigned the app active, which tore the reader down — so pressing
 * "pay by tapping" opened a sheet that closed itself about a second later, every
 * time. The same reasoning applies to the Bluetooth scanner and to a merchant's
 * card emulation: neither should stop because a permission alert appeared over
 * the screen that started it.
 */
export function appIsPresent(state: AppStateStatus = AppState.currentState): boolean {
  return state !== 'background';
}

/** Tracks {@link appIsPresent} across the app's lifecycle. */
export function useAppPresence(): boolean {
  const [present, setPresent] = useState(() => appIsPresent());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setPresent(appIsPresent(state)));
    return () => subscription.remove();
  }, []);
  return present;
}
