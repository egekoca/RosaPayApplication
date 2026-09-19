import {createHash, createHmac, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {p256} from '@noble/curves/nist.js';
import {derToCompactSignature, uncompressedPointFromSpki} from '@rosapay/secure-signer';

const CHALLENGE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 15 * 60_000;

export type DeviceChallenge = {
  id: string;
  publicSigner: string;
  digest: string;
  expiresAt: Date;
};

export interface DeviceAuthRepository {
  saveChallenge(challenge: DeviceChallenge): Promise<void>;
  consumeChallenge(id: string, publicSigner: string, now: Date): Promise<DeviceChallenge | null>;
  ensureUser(id: string): Promise<void>;
}

export class InMemoryDeviceAuthRepository implements DeviceAuthRepository {
  private readonly challenges = new Map<string, DeviceChallenge>();
  readonly users = new Set<string>();

  async saveChallenge(challenge: DeviceChallenge): Promise<void> {
    this.challenges.set(challenge.id, challenge);
  }

  async consumeChallenge(id: string, publicSigner: string, now: Date): Promise<DeviceChallenge | null> {
    const challenge = this.challenges.get(id);
    if (!challenge) return null;
    this.challenges.delete(id);
    return challenge.publicSigner === publicSigner && challenge.expiresAt > now ? challenge : null;
  }

  async ensureUser(id: string): Promise<void> {
    this.users.add(id);
  }
}

export class DeviceAuthenticationError extends Error {
  readonly code = 'DEVICE_AUTHENTICATION_FAILED';
}

type SessionPayload = {v: 1; sub: string; signer: string; exp: number};

export class DeviceAuthService {
  constructor(
    private readonly repository: DeviceAuthRepository,
    private readonly sessionSecret: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (Buffer.byteLength(sessionSecret) < 32) throw new Error('API_SESSION_SECRET must contain at least 32 bytes');
  }

  async challenge(publicSigner: string): Promise<{challengeId: string; challenge: string; expiresAt: string}> {
    const canonicalSigner = canonicalizeDevicePublicSigner(publicSigner);
    const now = this.now();
    const record: DeviceChallenge = {
      id: randomUUID(),
      publicSigner: canonicalSigner,
      digest: randomBytes(32).toString('base64'),
      expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
    };
    await this.repository.saveChallenge(record);
    return {challengeId: record.id, challenge: record.digest, expiresAt: record.expiresAt.toISOString()};
  }

  async createSession(input: {challengeId: string; publicSigner: string; signature: string}) {
    const canonicalSigner = canonicalizeDevicePublicSigner(input.publicSigner);
    const now = this.now();
    const challenge = await this.repository.consumeChallenge(input.challengeId, canonicalSigner, now);
    if (!challenge) throw new DeviceAuthenticationError('The device challenge is invalid, expired, or already used');

    let verified = false;
    try {
      const point = Buffer.from(canonicalSigner, 'base64');
      const compact = derToCompactSignature(Buffer.from(input.signature, 'base64'));
      verified = p256.verify(compact, Buffer.from(challenge.digest, 'base64'), point, {prehash: false});
    } catch {
      verified = false;
    }
    if (!verified) throw new DeviceAuthenticationError('The device signature is invalid');

    const userId = userIdForSigner(canonicalSigner);
    await this.repository.ensureUser(userId);
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    return {
      token: this.sign({v: 1, sub: userId, signer: canonicalSigner, exp: expiresAt.getTime()}),
      expiresAt: expiresAt.toISOString(),
    };
  }

  verifySession(token: string): {userId: string; publicSigner: string} | null {
    const [encoded, suppliedMac, extra] = token.split('.');
    if (!encoded || !suppliedMac || extra) return null;
    const expectedMac = createHmac('sha256', this.sessionSecret).update(encoded).digest();
    let actualMac: Buffer;
    try {
      actualMac = Buffer.from(suppliedMac, 'base64url');
    } catch {
      return null;
    }
    if (actualMac.length !== expectedMac.length || !timingSafeEqual(actualMac, expectedMac)) return null;
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<SessionPayload>;
      if (payload.v !== 1 || typeof payload.sub !== 'string' || typeof payload.signer !== 'string') return null;
      if (typeof payload.exp !== 'number' || payload.exp <= this.now().getTime()) return null;
      return {userId: payload.sub, publicSigner: payload.signer};
    } catch {
      return null;
    }
  }

  private sign(payload: SessionPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = createHmac('sha256', this.sessionSecret).update(encoded).digest('base64url');
    return `${encoded}.${mac}`;
  }
}

/** Maps both Android SPKI and iOS raw-point keys to the wallet contract signer bytes. */
export function canonicalizeDevicePublicSigner(publicSigner: string): string {
  try {
    const point = uncompressedPointFromSpki(Buffer.from(publicSigner, 'base64'));
    p256.Point.fromBytes(point);
    return Buffer.from(point).toString('base64');
  } catch {
    throw new DeviceAuthenticationError('The device public key is invalid');
  }
}

function userIdForSigner(publicSigner: string): string {
  const bytes = createHash('sha256').update(publicSigner).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
