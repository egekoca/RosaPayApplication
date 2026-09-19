import {signedPaymentIntentV1Schema} from '@rosapay/protocol';
import {z} from 'zod';

export const apiErrorResponseSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  issues: z.unknown().optional(),
});

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  storage: z.enum(['postgres', 'memory']).optional(),
});

export const deviceChallengeSchema = z.object({
  challengeId: z.string().uuid(),
  challenge: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export const deviceSessionSchema = z.object({
  token: z.string().min(32),
  expiresAt: z.string().datetime(),
});

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
  email: z.string().email().optional(),
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

/**
 * A merchant's promise that one named customer may pay one request. The
 * signature is absent until the merchant's device has left it.
 */
export const countersignatureSchema = z.object({
  intentId: z.string().min(1),
  customerAddress: z.string().regex(/^[GC][A-Z2-7]{55}$/),
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/).optional(),
  requestedAt: z.string().min(1),
  signedAt: z.string().min(1).optional(),
});

export type CountersignatureResponse = z.infer<typeof countersignatureSchema>;

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

/**
 * What a replacement phone is told about the wallet it is recovering. Both
 * fields are already public on the ledger; the passkey is what authorizes the
 * rotation, not this answer.
 */
export const recoverableWalletSchema = z.object({
  walletContractId: z.string().regex(/^C[A-Z2-7]{55}$/),
  retiredSigner: z.string().min(64).max(512),
  recoverySignerKind: z.enum(['Device', 'Passkey']),
});
export type RecoverableWalletResponse = z.infer<typeof recoverableWalletSchema>;

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
