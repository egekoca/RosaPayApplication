import type {FastifyRequest} from 'fastify';
import {parseSignedPaymentIntent, type SignedPaymentIntentV1} from '@rosapay/protocol';
import type {MerchantProfileRepository} from './MerchantProfileService';
import type {WalletRepository} from './WalletRepository';
import type {DeviceAuthService} from './DeviceAuthService';

export type ApiCapability = 'customer' | 'merchant';

export type ApiPrincipal = {
  userId: string;
  capabilities: readonly ApiCapability[];
  merchantProfileIds?: readonly string[];
  publicSigner?: string;
  walletContractId?: string;
};

export function createDeviceAuthResolver(
  sessions: DeviceAuthService,
  merchants: MerchantProfileRepository,
  wallets: WalletRepository,
): NonNullable<ApiAuthOptions['resolve']> {
  return async request => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    const session = sessions.verifySession(header.slice('Bearer '.length));
    if (!session) return null;
    const [profiles, wallet] = await Promise.all([
      merchants.findByOwner(session.userId),
      wallets.findBySigner(session.publicSigner),
    ]);
    const merchantProfileIds = profiles.map(profile => profile.id);
    return {
      userId: session.userId,
      publicSigner: session.publicSigner,
      capabilities: merchantProfileIds.length > 0 ? ['customer', 'merchant'] : ['customer'],
      merchantProfileIds,
      ...(wallet ? {walletContractId: wallet.contractAddress} : {}),
    };
  };
}

export function assertWalletOwnership(principal: ApiPrincipal | null, address: string): void {
  if (principal && principal.walletContractId !== address) {
    throw new CapabilityDeniedError('The wallet is not owned by the authenticated device');
  }
}

export type ApiAuthOptions = {
  required?: boolean;
  resolve?: (request: FastifyRequest) => ApiPrincipal | null | Promise<ApiPrincipal | null>;
};

export class AuthenticationRequiredError extends Error {
  readonly code = 'AUTHENTICATION_REQUIRED';
}

export class CapabilityDeniedError extends Error {
  readonly code = 'CAPABILITY_DENIED';
}

/** Any signed-in principal may drive their own payment; capability is checked per resource. */
export async function requireAuthenticatedPrincipal(
  request: FastifyRequest,
  options: ApiAuthOptions,
): Promise<ApiPrincipal | null> {
  const principal = await options.resolve?.(request) ?? null;
  if (!principal && options.required) {
    throw new AuthenticationRequiredError('An authenticated session is required');
  }
  return principal;
}

/** Resolves the caller once and applies the fail-closed capability rule. */
export async function requireMerchantPrincipal(
  request: FastifyRequest,
  options: ApiAuthOptions,
): Promise<ApiPrincipal | null> {
  const principal = await options.resolve?.(request) ?? null;
  if (!principal) {
    if (options.required) throw new AuthenticationRequiredError('An authenticated merchant session is required');
    return null;
  }
  if (!principal.capabilities.includes('merchant')) {
    throw new CapabilityDeniedError('Merchant capability is required for this operation');
  }
  return principal;
}

/** Guards a resource that belongs to one user; anonymous local mode owns nothing. */
export function assertResourceOwnership(principal: ApiPrincipal | null, ownerId: string | undefined): void {
  if (!principal) return;
  if (ownerId !== principal.userId) {
    throw new CapabilityDeniedError('The requested resource is not owned by the authenticated user');
  }
}

export async function authorizeMerchantIntent(
  input: unknown,
  request: FastifyRequest,
  options: ApiAuthOptions,
): Promise<SignedPaymentIntentV1> {
  const payload = parseSignedPaymentIntent(input);
  const principal = await options.resolve?.(request) ?? null;

  if (!principal) {
    if (options.required) throw new AuthenticationRequiredError('An authenticated merchant session is required');
    return payload;
  }
  if (!principal.capabilities.includes('merchant')) {
    throw new CapabilityDeniedError('Merchant capability is required for payment intent creation');
  }
  if (!principal.merchantProfileIds?.includes(payload.intent.merchantProfileId)) {
    throw new CapabilityDeniedError('Merchant profile is not owned by the authenticated user');
  }
  return payload;
}
