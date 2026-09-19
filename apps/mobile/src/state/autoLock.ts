/**
 * How long the app may sit in the background before it asks who you are again.
 *
 * Zero would be safest and unusable: stepping out to read a message and coming
 * straight back would mean another prompt every time. A minute covers that
 * without covering "someone picked up the phone I left on the counter".
 */
export const LOCK_AFTER_BACKGROUND_MS = 60_000;

export type LockDecision = {
  /** Null while the app is in the foreground. */
  backgroundedAt: number | null;
  now: number;
  graceMs?: number;
};

/**
 * Whether returning to the foreground should ask for the device again. A clock
 * that jumped backwards is treated as elapsed time rather than as "no time has
 * passed", so moving the clock cannot be used to skip the lock.
 */
export function shouldLockOnForeground({backgroundedAt, now, graceMs = LOCK_AFTER_BACKGROUND_MS}: LockDecision): boolean {
  if (backgroundedAt === null) return false;
  const elapsed = now - backgroundedAt;
  return elapsed < 0 || elapsed >= graceMs;
}
