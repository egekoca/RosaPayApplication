import {isValidStellarAddress} from '@rosapay/stellar';
import {z} from 'zod';

export const merchantProfileNetworks = ['testnet', 'pubnet'] as const;
export type MerchantProfileNetwork = (typeof merchantProfileNetworks)[number];

export type MerchantProfile = {
  id: string;
  userId?: string;
  displayName: string;
  recipient: string;
  signingKey: string;
  network: MerchantProfileNetwork;
  status: 'active';
};

export interface MerchantProfileRepository {
  findById(id: string): Promise<MerchantProfile | null>;
  findByOwner(userId: string): Promise<MerchantProfile[]>;
  save(profile: MerchantProfile): Promise<void>;
}

export class MerchantProfileConflictError extends Error {}
export class MerchantProfileInputError extends Error {}
export class MerchantProfileNotFoundError extends Error {}

export const createMerchantProfileSchema = z.object({
  id: z.union([z.string().uuid(), z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/i)]),
  displayName: z.string().trim().min(1).max(80),
  recipient: z.string().trim().min(1),
  signingKey: z.string().trim().min(1),
  network: z.enum(merchantProfileNetworks),
});

export type CreateMerchantProfileInput = z.infer<typeof createMerchantProfileSchema>;

export class MerchantProfileService {
  constructor(private readonly repository: MerchantProfileRepository) {}

  /**
   * Verifies the receiving address before a merchant can be paid: a malformed or
   * mistyped address would otherwise only fail after a customer has authorized.
   */
  async create(input: unknown, userId?: string): Promise<MerchantProfile> {
    const parsed = createMerchantProfileSchema.parse(input);
    if (!isValidStellarAddress(parsed.recipient)) {
      throw new MerchantProfileInputError('Receiving address must be a valid Stellar account or contract address');
    }
    if (!isValidStellarAddress(parsed.signingKey) || !parsed.signingKey.startsWith('G')) {
      throw new MerchantProfileInputError('Merchant signing key must be a valid Stellar G-address');
    }

    const existing = await this.repository.findById(parsed.id);
    if (existing) {
      if (
        existing.displayName !== parsed.displayName ||
        existing.recipient !== parsed.recipient ||
        existing.signingKey !== parsed.signingKey ||
        existing.network !== parsed.network ||
        existing.userId !== userId
      ) {
        throw new MerchantProfileConflictError('Merchant profile ID already exists with different details');
      }
      return existing;
    }

    const profile: MerchantProfile = {
      id: parsed.id,
      ...(userId === undefined ? {} : {userId}),
      displayName: parsed.displayName,
      recipient: parsed.recipient,
      signingKey: parsed.signingKey,
      network: parsed.network,
      status: 'active',
    };
    await this.repository.save(profile);
    return profile;
  }

  async get(id: string): Promise<MerchantProfile> {
    const profile = await this.repository.findById(id);
    if (!profile) throw new MerchantProfileNotFoundError('Merchant profile not found');
    return profile;
  }

  listForOwner(userId: string): Promise<MerchantProfile[]> {
    return this.repository.findByOwner(userId);
  }
}
