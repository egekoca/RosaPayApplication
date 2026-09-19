import {Buffer} from 'buffer';
import {RosaPayApiClient, ApiClientError} from '../../api/client';
import {sign as signEd25519} from '@noble/ed25519';
import type {MerchantProfile} from '../merchant/merchantProfile';
import {TestnetSettlementError} from './testnetSettlement';

export type CountersignatureInput = {
  intentId: string;
  /** The address that will pay, which the merchant has to name in its signature. */
  customerAddress: string;
  /** The contract digest to sign, which already names the customer. */
  digest: Uint8Array;
};

/** Produces the merchant's signature over a digest that names this payer. */
export type Countersigner = (input: CountersignatureInput) => Promise<Uint8Array>;

/**
 * Signs on this device, for the case where the merchant and the customer are
 * the same phone — a single-device demo, and the merchant paying itself.
 */
export function localCountersigner(profile: MerchantProfile): Countersigner {
  return async ({digest}) => signEd25519(digest, profile.developmentSigningSecret);
}

/**
 * Picks who produces the merchant's signature for this request.
 *
 * This device signs only when it is the merchant that made the request — a
 * single-device demo, or a merchant paying itself. Every other case is a
 * customer paying someone else's request, and the signing key is on the
 * merchant's phone, so it takes a round trip.
 */
export function selectCountersigner(input: {
  merchantProfile: MerchantProfile | null;
  merchantSigningKey: string;
  baseUrl: string;
  client?: RosaPayApiClient;
}): Countersigner {
  if (input.merchantProfile && input.merchantProfile.signingKey === input.merchantSigningKey) {
    return localCountersigner(input.merchantProfile);
  }
  return remoteCountersigner(input.client ?? new RosaPayApiClient({baseUrl: input.baseUrl}));
}

export type RemoteCountersignerOptions = {
  pollIntervalMs?: number;
  /**
   * How long a customer stands there before being told to try again. Long
   * enough for a merchant phone to notice and sign, short enough that a
   * merchant who has walked away does not leave someone waiting silently.
   */
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Asks the merchant's own device for the signature, through the API.
 *
 * The settlement contract verifies a merchant signature over a digest that
 * names the payer, so it cannot be produced before the payer is known. The
 * merchant's signing key never leaves the merchant's phone, which is why this is
 * a round trip rather than a lookup.
 */
export function remoteCountersigner(
  client: RosaPayApiClient,
  {pollIntervalMs = 1_000, timeoutMs = 45_000, sleep = defaultSleep}: RemoteCountersignerOptions = {},
): Countersigner {
  return async ({intentId, customerAddress}) => {
    try {
      const claimed = await client.requestCountersignature(intentId, customerAddress);
      if (claimed.signature) return decode(claimed.signature);
    } catch (error) {
      throw asSettlementError(error);
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(pollIntervalMs);
      let current;
      try {
        current = await client.getCountersignature(intentId);
      } catch (error) {
        // A poll that fails is not the payment failing; keep waiting until the
        // deadline, and let the deadline be what gives up.
        if (error instanceof ApiClientError && error.status !== null && error.status < 500) {
          throw asSettlementError(error);
        }
        continue;
      }
      if (current.signature) return decode(current.signature);
    }

    throw new TestnetSettlementError(
      'MERCHANT_KEY_UNAVAILABLE',
      'The merchant did not approve this payment in time. Ask them to show the request again.',
    );
  };
}

function decode(signature: string): Uint8Array {
  return Uint8Array.from(Buffer.from(signature, 'base64'));
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function asSettlementError(error: unknown): Error {
  if (error instanceof ApiClientError && error.code === 'COUNTERSIGNATURE_CONFLICT') {
    return new TestnetSettlementError(
      'MERCHANT_KEY_UNAVAILABLE',
      'Someone else is already paying this request. Ask the merchant for a new one.',
    );
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return new TestnetSettlementError(
      'MERCHANT_KEY_UNAVAILABLE',
      'The merchant has not published this request, so it cannot be approved.',
    );
  }
  return error instanceof Error ? error : new Error('The merchant could not be reached');
}
