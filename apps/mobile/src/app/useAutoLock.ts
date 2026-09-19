import {useEffect, useRef} from 'react';
import {AppState, type AppStateStatus} from 'react-native';
import {useAppStore} from '../state/appStore';
import {shouldLockOnForeground} from '../state/autoLock';

/**
 * Locks the app when it comes back from the background after long enough away.
 *
 * Only a real background counts. iOS reports `inactive` for a notification
 * shade, a system permission sheet or the Face ID prompt itself, and treating
 * those as leaving would lock the app during the very act of unlocking it.
 */
export function useAutoLock(): void {
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    const handle = (status: AppStateStatus) => {
      if (status === 'background') {
        backgroundedAt.current = Date.now();
        return;
      }
      if (status !== 'active') return;

      if (shouldLockOnForeground({backgroundedAt: backgroundedAt.current, now: Date.now()})) {
        // The store refuses to lock a session that has no account, so this is
        // safe to call unconditionally.
        useAppStore.getState().lock();
      }
      backgroundedAt.current = null;
    };

    const subscription = AppState.addEventListener('change', handle);
    return () => subscription.remove();
  }, []);
}
