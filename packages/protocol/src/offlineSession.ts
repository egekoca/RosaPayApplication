import {z} from 'zod';

/**
 * The conversation two phones have when the paying one has no network.
 *
 * RTP/1 already says what a payment request is; this says how the two halves of
 * an offline authorization cross a radio. The split is the whole idea: the
 * merchant is online, so it simulates the settlement and hands over the single
 * `SorobanAuthorizationEntry` the customer has to sign, and the customer — which
 * may be in airplane mode — checks that entry against the request on its screen,
 * signs it with its device key and hands it back. The merchant submits.
 *
 * Nothing here is trusted. Every field a merchant sends is re-derived locally by
 * the customer from the intent it already verified, so a merchant that changes
 * the amount, the payer or the recipient between the request and the entry
 * produces something that never reaches a device prompt.
 */
export const OFFLINE_SESSION_VERSION = 'RTP/1';

/**
 * What each message is, and the byte the transport carries it under.
 *
 * Numbers rather than names on the wire: a frame header has three bytes in it
 * at an MTU of 23, and the kind is one of them.
 */
export const offlineSessionKinds = {
  /** Merchant → customer: the signed request, the same URI a QR carries. */
  request: 1,
  /** Customer → merchant: who is paying, so the merchant can simulate. */
  payer: 2,
  /** Merchant → customer: the one entry that needs a signature. */
  authRequest: 3,
  /** Customer → merchant: that entry, signed by the device. */
  authorization: 4,
  /** Merchant → customer: what the chain said. */
  result: 5,
  /** Either side: this is not going to happen, and why. */
  decline: 6,
} as const;

export type OfflineSessionKind = keyof typeof offlineSessionKinds;

const byCode = new Map<number, OfflineSessionKind>(
  Object.entries(offlineSessionKinds).map(([name, code]) => [code, name as OfflineSessionKind]),
);

export function offlineSessionKindCode(kind: OfflineSessionKind): number {
  return offlineSessionKinds[kind];
}

/** The kind a transport byte names, or nothing when a peer speaks a later dialect. */
export function offlineSessionKindOf(code: number): OfflineSessionKind | null {
  return byCode.get(code) ?? null;
}

const version = z.literal(OFFLINE_SESSION_VERSION);
const intentId = z.string().min(1).max(128);

/**
 * The customer naming itself.
 *
 * The invocation the customer will be asked to sign names the payer, so the
 * merchant cannot build it until this arrives. That is why an offline payment
 * is a conversation rather than a single tap.
 */
export const offlinePayerSchema = z.object({
  v: version,
  intentId,
  /** Contract address for a smart wallet, `G…` for a classic account. */
  payer: z.string().min(1).max(80),
  account: z.enum(['smart-wallet', 'classic']),
});
export type OfflinePayerMessage = z.infer<typeof offlinePayerSchema>;

/**
 * The merchant's answer: everything needed to sign, and nothing else.
 *
 * `latestLedger` is here because the customer has no way to read one. It is
 * used to show how long the authorization stays worth submitting, never to
 * decide whether to sign — the expiry that matters is inside the entry and is
 * checked against the intent the customer already holds.
 */
export const offlineAuthRequestSchema = z.object({
  v: version,
  intentId,
  networkPassphrase: z.string().min(1).max(200),
  settlementContractId: z.string().min(1).max(80),
  entryXdr: z.string().min(1).max(8_192),
  signatureExpirationLedger: z.number().int().positive(),
  latestLedger: z.number().int().positive(),
});
export type OfflineAuthRequestMessage = z.infer<typeof offlineAuthRequestSchema>;

/** The signed entry going back. */
export const offlineAuthorizationSchema = z.object({
  v: version,
  intentId,
  authorizer: z.string().min(1).max(80),
  signatureExpirationLedger: z.number().int().positive(),
  entryXdr: z.string().min(1).max(8_192),
});
export type OfflineAuthorizationMessage = z.infer<typeof offlineAuthorizationSchema>;

/**
 * What happened on the chain, sent back so the customer's screen can settle.
 *
 * A phone in airplane mode cannot confirm its own payment. It can be told, by
 * the phone that submitted it, with a transaction hash it will be able to check
 * the moment it has signal again.
 */
export const offlineResultSchema = z.object({
  v: version,
  intentId,
  status: z.enum(['confirmed', 'failed']),
  transactionHash: z.string().min(1).max(128).optional(),
  ledger: z.number().int().positive().optional(),
  message: z.string().max(400).optional(),
});
export type OfflineResultMessage = z.infer<typeof offlineResultSchema>;

/** Said out loud rather than by falling silent, so the other side can explain. */
export const offlineDeclineSchema = z.object({
  v: version,
  intentId,
  reason: z.string().max(400),
});
export type OfflineDeclineMessage = z.infer<typeof offlineDeclineSchema>;

const schemas = {
  payer: offlinePayerSchema,
  authRequest: offlineAuthRequestSchema,
  authorization: offlineAuthorizationSchema,
  result: offlineResultSchema,
  decline: offlineDeclineSchema,
} as const;

type SchemaKind = keyof typeof schemas;

export type OfflineSessionBody<K extends SchemaKind> = z.infer<(typeof schemas)[K]>;

/**
 * Serializes a message. The schema runs on the way out as well as in, so a
 * malformed message is caught on the phone that built it rather than becoming a
 * silence on the phone that was waiting for it.
 */
export function encodeOfflineSessionMessage<K extends SchemaKind>(
  kind: K,
  body: OfflineSessionBody<K>,
): string {
  return JSON.stringify(schemas[kind].parse(body));
}

/**
 * Reads a message of the kind the caller is expecting, or nothing.
 *
 * Returning null rather than throwing is deliberate: this is fed by a radio,
 * where a half-received or stale frame is an ordinary event, and the caller's
 * answer to all of them is the same — keep waiting.
 */
export function decodeOfflineSessionMessage<K extends SchemaKind>(
  kind: K,
  payload: string,
): OfflineSessionBody<K> | null {
  if (payload.length > 16_384) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  const result = schemas[kind].safeParse(parsed);
  return result.success ? (result.data as OfflineSessionBody<K>) : null;
}
