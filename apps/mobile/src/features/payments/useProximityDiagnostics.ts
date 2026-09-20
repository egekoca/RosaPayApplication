import {useEffect, useState} from 'react';
import {subscribeToProximityDiagnostics} from '../../native/nativeProximity';

/** Kept short: this is a window on what is happening now, not a history. */
const MAX_ENTRIES = 40;

export type ProximityDiagnosticEntry = {
  /** Wall-clock time the line arrived, so gaps between readings are visible. */
  at: string;
  message: string;
};

/**
 * Collects what the radio says about itself while the screen is open.
 *
 * Two phones held together that do nothing give a person nothing to act on.
 * Native narrates each step it takes — advertising, listening, a merchant seen
 * at some strength, a run of readings too short, a connection — so the failure
 * names itself instead of being guessed at. Reading this changes nothing: the
 * scanner and the advertisement belong to the payment screens.
 */
export function useProximityDiagnostics(): ProximityDiagnosticEntry[] {
  const [entries, setEntries] = useState<ProximityDiagnosticEntry[]>([]);

  useEffect(() => {
    return subscribeToProximityDiagnostics(message => {
      const at = new Date().toLocaleTimeString();
      setEntries(current => {
        // Newest first: the interesting line is the last thing that happened,
        // and a person holding two phones cannot scroll.
        const next = [{at, message}, ...current];
        return next.length > MAX_ENTRIES ? next.slice(0, MAX_ENTRIES) : next;
      });
    });
  }, []);

  return entries;
}
