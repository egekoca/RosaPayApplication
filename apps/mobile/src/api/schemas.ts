import {signedPaymentIntentV1Schema} from '@rosapay/protocol';
import {z} from 'zod';

export const apiErrorResponseSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  issues: z.unknown().optional(),
});

export const healthResponseSchema = z.object({status: z.literal('ok')});

export const storedIntentSchema = z.object({
  payload: signedPaymentIntentV1Schema,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().min(16),
  status: z.literal('created'),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
export type StoredIntentResponse = z.infer<typeof storedIntentSchema>;
