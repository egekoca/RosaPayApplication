import {create} from 'zustand';

/**
 * The one control that opens a platform reader which cannot sit armed.
 *
 * Android polls silently, so nothing here is ever set on it and no screen shows
 * a tap button. iOS puts a system sheet on screen, so a session can only begin
 * on a deliberate press — and the listener that owns the reader is mounted
 * beside the navigator, out of reach of the screen a customer is looking at.
 * This carries the opener across that gap so the home screen can offer tapping
 * without opening a second, competing reader of its own.
 */
type NfcTapControl = {
  /** Set only while a reader is waiting to be opened by hand. */
  startTap: (() => void) | undefined;
  setStartTap(startTap: (() => void) | undefined): void;
};

export const useNfcTapControl = create<NfcTapControl>(set => ({
  startTap: undefined,
  setStartTap: startTap =>
    // The listener re-publishes on every render; only a real change should wake
    // the screens subscribed to this.
    set(state => (state.startTap === startTap ? state : {startTap})),
}));
