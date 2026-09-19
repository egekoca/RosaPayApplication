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

export const merchantProfileSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1).optional(),
  displayName: z.string().min(1),
  recipient: z.string().min(1),
  signingKey: z.string().min(1),
  network: z.enum(['testnet', 'pubnet']),
  status: z.literal('active'),
});

export const merchantRegistrationSchema = z.object({
  merchantProfileId: z.string().min(1),
  merchantId: z.string().regex(/^[a-f0-9]{64}$/),
  transactionHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export type MerchantProfileResponse = z.infer<typeof merchantProfileSchema>;
export type MerchantRegistrationResponse = z.infer<typeof merchantRegistrationSchema>;

export const settlementRecordSchema = z.object({
  intentId: z.string().min(1),
  status: z.enum(['created', 'awaiting_approval', 'authorized', 'submitted', 'confirmed', 'rejected', 'expired', 'failed']),
  transactionHash: z.string().optional(),
  ledger: z.number().int().positive().optional(),
  failureCode: z.string().optional(),
  confirmedAt: z.string().optional(),
});

export type SettlementRecordResponse = z.infer<typeof settlementRecordSchema>;
