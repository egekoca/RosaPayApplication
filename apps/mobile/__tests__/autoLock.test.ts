import {LOCK_AFTER_BACKGROUND_MS, shouldLockOnForeground} from '../src/state/autoLock';

const now = 1_800_000_000_000;

describe('locking after time away', () => {
  it('leaves a foreground session alone', () => {
    expect(shouldLockOnForeground({backgroundedAt: null, now})).toBe(false);
  });

  it('lets a quick trip to another app pass without a prompt', () => {
    expect(shouldLockOnForeground({backgroundedAt: now - 5_000, now})).toBe(false);
  });

  it('locks once the phone has been away long enough to change hands', () => {
    expect(shouldLockOnForeground({backgroundedAt: now - LOCK_AFTER_BACKGROUND_MS, now})).toBe(true);
    expect(shouldLockOnForeground({backgroundedAt: now - 10 * 60_000, now})).toBe(true);
  });

  it('locks when the clock moved backwards, rather than trusting it', () => {
    // Winding the clock back would otherwise read as "no time has passed" and
    // hand the session to whoever did it.
    expect(shouldLockOnForeground({backgroundedAt: now + 60_000, now})).toBe(true);
  });

  it('honours a caller-supplied grace period', () => {
    expect(shouldLockOnForeground({backgroundedAt: now - 2_000, now, graceMs: 1_000})).toBe(true);
  });
});
