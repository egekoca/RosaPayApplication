import {describe, expect, it} from 'vitest';
import {RateLimiter, RateLimitError} from '../src/application/RateLimiter';

describe('rate limiter', () => {
  it('allows a burst up to the limit and then refuses with a retry hint', () => {
    let now = 0;
    const limiter = new RateLimiter({limit: 2, windowMs: 60_000, now: () => now});

    expect(limiter.check('caller').allowed).toBe(true);
    expect(limiter.check('caller').allowed).toBe(true);

    const refused = limiter.check('caller');
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(60);
  });

  it('starts a new window once the old one passes', () => {
    let now = 0;
    const limiter = new RateLimiter({limit: 1, windowMs: 1_000, now: () => now});

    expect(limiter.check('caller').allowed).toBe(true);
    expect(limiter.check('caller').allowed).toBe(false);

    now = 1_001;
    expect(limiter.check('caller').allowed).toBe(true);
  });

  it('counts callers separately', () => {
    const limiter = new RateLimiter({limit: 1, windowMs: 60_000});
    expect(limiter.check('first').allowed).toBe(true);
    expect(limiter.check('second').allowed).toBe(true);
    expect(limiter.check('first').allowed).toBe(false);
  });

  it('throws a typed error a route can turn into 429', () => {
    const limiter = new RateLimiter({limit: 1, windowMs: 60_000});
    limiter.assert('caller');
    expect(() => limiter.assert('caller')).toThrow(RateLimitError);
  });

  it('refuses a limit or window that would disable it', () => {
    expect(() => new RateLimiter({limit: 0, windowMs: 1_000})).toThrow('at least one request');
    expect(() => new RateLimiter({limit: 1, windowMs: 0})).toThrow('positive number of milliseconds');
  });
});
