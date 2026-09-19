import {z} from 'zod';

const stellarAddress = z
  .string()
  .length(56)
  .regex(/^[GC][A-Z2-7]+$/, 'Expected a Stellar account or contract address');

const entityId = z.union([
  z.string().uuid(),
  z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/i, 'Expected a UUID or ULID'),
]);

export const assetSchema = z
  .object({
    type: z.enum(['native', 'credit', 'sac']),
    code: z.string().min(1).max(12),
    issuer: stellarAddress.optional(),
    contractId: stellarAddress.optional(),
    decimals: z.number().int().min(0).max(18),
  })
  .superRefine((asset, context) => {
    if (asset.type === 'native' && (asset.code !== 'XLM' || asset.issuer || asset.contractId)) {
      context.addIssue({code: 'custom', message: 'Native assets must be XLM without issuer or contractId'});
    }
    if (asset.type === 'credit' && !asset.issuer) {
      context.addIssue({code: 'custom', message: 'Credit assets require an issuer'});
    }
    if (asset.type === 'sac' && !asset.contractId) {
      context.addIssue({code: 'custom', message: 'SAC assets require a contractId'});
    }
  });

export const paymentIntentV1Schema = z.object({
  version: z.literal('RTP/1'),
  intentId: entityId,
  network: z.enum(['testnet', 'pubnet']),
  merchantProfileId: entityId,
  merchantName: z.string().trim().min(1).max(80),
  merchantSigningKey: stellarAddress.refine(value => value.startsWith('G'), 'Expected a G-address'),
  recipient: stellarAddress,
  asset: assetSchema,
  amount: z
    .string()
    .regex(/^(0|[1-9]\d*)(\.\d*[1-9])?$/, 'Expected a canonical non-negative decimal'),
  reference: z.string().trim().min(1).max(120),
  nonce: z.string().min(16).max(128),
  expiresAtLedger: z.number().int().positive(),
  createdAt: z.string().datetime({offset: true}),
});

export const signedPaymentIntentV1Schema = z.object({
  intent: paymentIntentV1Schema,
  signature: z.string().min(1),
});

export type PaymentAsset = z.infer<typeof assetSchema>;
export type PaymentIntentV1 = z.infer<typeof paymentIntentV1Schema>;
export type SignedPaymentIntentV1 = z.infer<typeof signedPaymentIntentV1Schema>;
