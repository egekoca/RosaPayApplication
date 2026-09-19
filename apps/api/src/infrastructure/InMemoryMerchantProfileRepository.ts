import type {MerchantProfile, MerchantProfileRepository} from '../application/MerchantProfileService';

export class InMemoryMerchantProfileRepository implements MerchantProfileRepository {
  private readonly byId = new Map<string, MerchantProfile>();

  async findById(id: string) {
    return this.byId.get(id) ?? null;
  }

  async findByOwner(userId: string) {
    return [...this.byId.values()].filter(profile => profile.userId === userId);
  }

  async save(profile: MerchantProfile) {
    this.byId.set(profile.id, profile);
  }
}
