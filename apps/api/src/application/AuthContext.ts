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

/**
 * Binds a device to the wallet this API provisioned for it, where there is one.
 *
 * `walletContractId` is only ever set for a smart wallet this API deployed. A
 * customer who arrived with twelve words pays from a classic account it has
 * never seen, so the comparison was `undefined !== 'G…'` and every such payer
 * was refused — at the moment they claimed a request, which is the first step
 * of paying. They had signed nothing, spent nothing, and were told only that
 * the payment could not be completed.
 *
 * Silence about an address is not evidence against it. So this stays strict for
 * a device that does have a provisioned wallet — it must use that one — and
 * allows a claim through when there is nothing to compare against.
 *
 * What that concedes is bounded. Claiming a request moves no money: it asks the
 * merchant to sign a digest naming this payer, and the payment still requires
 * the payer's own key to authorize the contract call. The worst an untruthful
 * claim achieves is occupying one request, which the one-customer-per-request
 * conflict rule already treats as a race to be lost.
 */
export function assertWalletOwnership(principal: ApiPrincipal | null, address: string): void {
  if (principal?.walletContractId && principal.walletContractId !== address) {
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
