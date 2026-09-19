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

export const provisionedWalletSchema = z.object({
  walletContractId: z.string().regex(/^C[A-Z2-7]{55}$/),
  devicePublicKey: z.string().min(1),
  transactionHash: z.string().regex(/^[a-f0-9]{64}$/),
  fundedAmount: z.string().min(1),
});

export type ProvisionedWalletResponse = z.infer<typeof provisionedWalletSchema>;

export const merchantPaymentSchema = z.object({
  intentId: z.string().min(1),
  amount: z.string().min(1),
  assetCode: z.string().min(1),
  reference: z.string().min(1),
  createdAt: z.string().min(1),
  status: z.enum(['created', 'awaiting_approval', 'authorized', 'submitted', 'confirmed', 'rejected', 'expired', 'failed']),
  transactionHash: z.string().optional(),
  ledger: z.number().int().positive().optional(),
  confirmedAt: z.string().optional(),
});

export const merchantPaymentsSchema = z.object({
  merchantProfileId: z.string().min(1),
  payments: z.array(merchantPaymentSchema),
});

export type MerchantPaymentResponse = z.infer<typeof merchantPaymentSchema>;
