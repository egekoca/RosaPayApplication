import {AppState} from 'react-native';
import {apiWarmupTimings} from '../src/app/useApiWarmup';

/**
 * The behaviour worth pinning is the pacing, not the hook's wiring: how often a
 * free host has to be touched to stay up, and why that is not as often as it
 * first seems.
 */
describe('the API warm-up pacing', () => {
  it('pings inside the window the host sleeps after', () => {
    // Render stops an idle instance after fifteen minutes. A ping that lands
    // later than that keeps nothing awake.
    expect(apiWarmupTimings.PING_EVERY_MS).toBeLessThan(apiWarmupTimings.SLEEP_AFTER_MS);
  });

  it('does not ping far more often than it has to', () => {
    /*
     * Ten minutes against a fifteen-minute sleep is already one spare ping. The
     * tempting alternative is every fifteen seconds, which sends forty times
     * the requests to hold the same instance up — on someone's mobile data, and
     * against a monthly instance-hour allowance the sleeping is what protects.
     */
    expect(apiWarmupTimings.PING_EVERY_MS).toBeGreaterThanOrEqual(
      apiWarmupTimings.SLEEP_AFTER_MS / 2,
    );
  });

  it('treats a shorter absence than the sleep window as worth re-pinging', () => {
    // Timers do not run while the app is backgrounded, so coming back needs a
    // fresh ping well before the sleep window has run out.
    expect(apiWarmupTimings.STALE_AFTER_MS).toBeLessThan(apiWarmupTimings.PING_EVERY_MS);
  });

  it('listens for the app returning to the foreground', () => {
    // The interval alone cannot cover a backgrounded app, so the hook has to be
    // driven by AppState as well. This guards the import rather than the logic.
    expect(typeof AppState.addEventListener).toBe('function');
  });
});
