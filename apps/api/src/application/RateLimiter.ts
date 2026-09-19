export type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export type RateLimiterOptions = {
  /** Requests allowed per window, per key. */
  limit: number;
  windowMs: number;
  now?: () => number;
};

export class RateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests');
    this.name = 'RateLimitError';
  }
}

/**
 * A fixed window per caller, kept in process. It protects the endpoints that
 * spend real funds — deploying a wallet and signing a settlement — from being
 * driven in a loop. A deployment behind more than one instance needs a shared
 * store; this bounds the damage a single instance can be made to do.
 *
 * What counts as a caller is the caller's decision, and it matters more than it
 * looks. Keying on the network address makes a room of people behind one router
 * into a single caller, so the fourth person to open the app is told to come
 * back in an hour. The routes key on the authenticated device where there is
 * one, and keep a much looser address-wide ceiling behind it.
 */
export class RateLimiter {
  private readonly windows = new Map<string, {count: number; resetAt: number}>();

  constructor(private readonly options: RateLimiterOptions) {
    if (!Number.isSafeInteger(options.limit) || options.limit <= 0) {
      throw new Error('A rate limit must allow at least one request');
    }
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs <= 0) {
      throw new Error('A rate limit window must be a positive number of milliseconds');
    }
  }

  check(key: string): RateLimitDecision {
    const now = this.options.now?.() ?? Date.now();
    const window = this.windows.get(key);

    if (!window || window.resetAt <= now) {
      this.windows.set(key, {count: 1, resetAt: now + this.options.windowMs});
      this.evictExpired(now);
      return {allowed: true, retryAfterSeconds: 0};
    }
    if (window.count >= this.options.limit) {
      return {allowed: false, retryAfterSeconds: Math.ceil((window.resetAt - now) / 1000)};
    }

    window.count += 1;
    return {allowed: true, retryAfterSeconds: 0};
  }

  /** Rejects instead of returning a decision, for use directly in a route. */
  assert(key: string): void {
    const decision = this.check(key);
    if (!decision.allowed) throw new RateLimitError(decision.retryAfterSeconds);
  }

  private evictExpired(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}
