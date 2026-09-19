import {ApiClientError} from './client';

export type RetryPolicy = {
  /** Total attempts including the first one. */
  attempts: number;
  /** Delay before the second attempt; each further wait doubles it. */
  baseDelayMs: number;
};

export const defaultRetryPolicy: RetryPolicy = {attempts: 3, baseDelayMs: 400};

/**
 * Whether a failure is worth trying again.
 *
 * A dropped packet, a timeout, an overloaded server and a rate limit all say
 * "not now". Every other status is the server having read the request and
 * decided: a malformed intent stays malformed however many times it is sent, and
 * retrying it only delays telling the person what is wrong.
 */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiClientError)) return false;
  if (error.status === null) {
    return error.code === 'NETWORK_ERROR' || error.code === 'REQUEST_TIMEOUT';
  }
  return error.status === 429 || error.status >= 500;
}

/** Backoff for the wait before attempt `attempt` (1 is the first retry). */
export function retryDelayMs(attempt: number, policy: RetryPolicy = defaultRetryPolicy): number {
  return policy.baseDelayMs * 2 ** (attempt - 1);
}
