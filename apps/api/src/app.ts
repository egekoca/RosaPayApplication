import Fastify from 'fastify';
import type {FastifyRequest} from 'fastify';
import {ZodError, z} from 'zod';
import {createStellarConfig, StellarRpcClient} from '@rosapay/stellar';
import {
  CountersignatureConflictError,
  CountersignatureNotFoundError,
  IntentConflictError,
  SettlementNotFoundError,
  type IntentRepository,
  IntentService,
  SettlementInputError,
  SettlementTransitionError,
} from './application/IntentService';
import {
  ApiAuthOptions,
  assertResourceOwnership,
  assertWalletOwnership,
  AuthenticationRequiredError,
  authorizeMerchantIntent,
  CapabilityDeniedError,
  requireAuthenticatedPrincipal,
  requireMerchantPrincipal,
} from './application/AuthContext';
import {
  type MerchantProfileRepository,
  MerchantProfileConflictError,
  MerchantProfileInputError,
  MerchantProfileNotFoundError,
  MerchantProfileService,
} from './application/MerchantProfileService';
import {RelayerError, RelayerService} from './application/RelayerService';
import {WalletProvisioningError, WalletProvisioningService} from './application/WalletProvisioningService';
import type {WalletRepository} from './application/WalletRepository';
import {RateLimiter, RateLimitError} from './application/RateLimiter';
import {AuditLog, InMemoryAuditLog, type AuditLogRepository} from './application/AuditLog';
import {InMemoryIntentRepository} from './infrastructure/InMemoryIntentRepository';
import {InMemoryMerchantProfileRepository} from './infrastructure/InMemoryMerchantProfileRepository';
import {
  canonicalizeDevicePublicSigner,
  DeviceAuthenticationError,
  type DeviceAuthService,
} from './application/DeviceAuthService';
import {PriceService, PriceUnavailableError} from './application/PriceService';

const paramsSchema = z.object({intentId: z.string().min(1)});
const profileParamsSchema = z.object({merchantProfileId: z.string().min(1)});
const relayerTransactionSchema = z.object({xdr: z.string().min(1).max(65_536)});
const authorizeSchema = z.object({
  authorizer: z.string().regex(/^[GC][A-Z2-7]{55}$/),
  authorizationHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  expiresAtLedger: z.number().int().positive().optional(),
});
const submitSchema = z.object({transactionHash: z.string().regex(/^[a-f0-9]{64}$/i)});
const walletSchema = z.object({
  devicePublicKey: z.string().min(64).max(512),
  /**
   * The key that may rotate a lost device signer. A wallet created without one
   * is a wallet that dies with the handset, so the app always sends a passkey
   * here - but it stays optional, because refusing to provision at all would be
   * worse than provisioning a single-device wallet on a phone that cannot hold
   * a passkey.
   */
  recovery: z
    .object({
      publicKey: z.string().min(64).max(512),
      credentialId: z.string().min(1).max(512),
      kind: z.enum(['Device', 'Passkey']),
    })
    .optional(),
});
const walletRecoverySchema = z.object({credentialId: z.string().min(1).max(512)});
const stellarAddress = z.string().regex(/^[GC][A-Z2-7]{55}$/);
const countersignatureRequestSchema = z.object({customerAddress: stellarAddress});
const countersignatureSchema = z.object({
  customerAddress: stellarAddress,
  // A base64 Ed25519 signature is exactly 64 bytes.
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
});
const pricesQuerySchema = z.object({
  sell_asset: z.string().min(1).max(120),
  // SEP-38 allows asking by either side; this server prices what is being sold.
  sell_amount: z.string().min(1).max(40).default('1'),
});
const deviceAuthChallengeSchema = z.object({publicSigner: z.string().min(64).max(512)});
const deviceAuthSessionSchema = z.object({
  challengeId: z.string().uuid(),
  publicSigner: z.string().min(64).max(512),
  signature: z.string().min(8).max(256),
});

export type BuildAppOptions = {
  repository?: IntentRepository;
  /** Reported by health so a client can tell durable storage from memory. */
  storage?: 'postgres' | 'memory';
  merchantProfiles?: MerchantProfileRepository;
  auth?: ApiAuthOptions;
  relayer?: RelayerService;
  wallets?: WalletProvisioningService;
  walletRepository?: WalletRepository;
  auditLog?: AuditLogRepository;
  deviceAuth?: DeviceAuthService;
  prices?: PriceService;
};

export function buildApp({
  repository = new InMemoryIntentRepository(),
  storage = 'memory',
  merchantProfiles = new InMemoryMerchantProfileRepository(),
  auth,
  relayer,
  wallets,
  walletRepository,
  auditLog,
  deviceAuth,
  prices,
}: BuildAppOptions = {}) {
  const app = Fastify({logger: {redact: ['req.headers.authorization', 'req.body.signature', 'req.body.authorization']}});
  const intents = new IntentService(repository);
  const merchants = new MerchantProfileService(merchantProfiles);
  const audit = new AuditLog(auditLog ?? new InMemoryAuditLog());
  const authOptions: ApiAuthOptions = auth ?? {required: process.env.API_AUTH_REQUIRED === 'true'};
  const stellarConfig = createStellarConfig(process.env.STELLAR_NETWORK ?? 'testnet', {
    rpcUrl: process.env.STELLAR_RPC_URL,
    settlementContractId: process.env.STELLAR_SETTLEMENT_CONTRACT_ID,
  });
  const stellar = new StellarRpcClient(stellarConfig);
  const walletService = wallets ?? new WalletProvisioningService({
    config: stellarConfig,
    ...(walletRepository ? {wallets: walletRepository} : {}),
    ...(process.env.STELLAR_WALLET_WASM_HASH ? {walletWasmHash: process.env.STELLAR_WALLET_WASM_HASH} : {}),
    ...(process.env.STELLAR_ADMIN_SECRET ? {deployerSecret: process.env.STELLAR_ADMIN_SECRET} : {}),
    ...(process.env.STELLAR_WALLET_FUNDING ? {fundingAmount: process.env.STELLAR_WALLET_FUNDING} : {}),
  });
  // The endpoints that spend funds are the ones worth limiting.
  const walletLimiter = new RateLimiter({limit: 3, windowMs: 60 * 60 * 1000});
  const relayerLimiter = new RateLimiter({limit: 30, windowMs: 60 * 1000});
  /**
   * A ceiling over one address, sized for a room rather than a person. It is
   * not the protection - `relayerLimiter` is - but it stops a single machine
   * looping an endpoint faster than any crowd could.
   */
  const venueLimiter = new RateLimiter({limit: 600, windowMs: 60 * 1000});
  const authenticationLimiter = new RateLimiter({limit: 10, windowMs: 60 * 1000});
  // Rates are cached upstream, so this only bounds how hard one caller can ask.
  const priceLimiter = new RateLimiter({limit: 60, windowMs: 60 * 1000});
  const callerKey = (request: FastifyRequest) => request.ip ?? 'unknown';

  /**
   * Who a rate limit is counted against.
   *
   * The address is the wrong answer on its own. A room of people demonstrating
   * this app is behind one router, so counting by IP makes thirty phones look
   * like one caller and the fourth person to try is told to come back in an
   * hour. Counting by the device that authenticated is what these limits were
   * always for: stopping one client from driving an endpoint in a loop.
   *
   * The address is still the fallback, because an unauthenticated caller has
   * nothing else to be identified by - and `venueLimiter` keeps a much looser
   * ceiling over the whole address, so a runaway is still bounded without a
   * crowd being mistaken for one.
   */
  const limitKey = (request: FastifyRequest, principal?: {publicSigner?: string} | null) =>
    principal?.publicSigner ? `signer:${principal.publicSigner}` : `ip:${callerKey(request)}`;

  const relayerService = relayer ?? new RelayerService({
    config: stellarConfig,
    ...(process.env.STELLAR_RELAYER_SECRET ? {relayerSecret: process.env.STELLAR_RELAYER_SECRET} : {}),
    ...(process.env.STELLAR_ADMIN_SECRET ? {adminSecret: process.env.STELLAR_ADMIN_SECRET} : {}),
  });

  // The storage mode is part of health because in-memory data disappears on
  // restart, and a client that records payments deserves to know that.
  app.get('/v1/health', async () => ({status: 'ok', storage}));
  /**
   * SEP-38 indicative prices, served by this deployment rather than an anchor.
   *
   * Nothing on Stellar quotes Turkish lira — of every domain in the Stellar
   * Anchor Directory, two publish a quote server and both price only the
   * Brazilian real — so a merchant who sets prices in lira has to get the rate
   * from somewhere. Serving it in SEP-38's own shape means the app reads it
   * with the same code it would read a real anchor with, and pointing it at one
   * later costs a configuration change rather than a rewrite.
   *
   * Unauthenticated, as SEP-38 specifies for `/info` and `/prices`. There is
   * deliberately no `/quote`: a firm rate is a promise to exchange at it, and
   * this deployment settles on chain instead of exchanging anything.
   */
  app.get('/sep38/info', async (request, reply) => {
    if (!prices) return reply.code(503).send({code: 'PRICING_DISABLED', message: 'This deployment serves no rates'});
    return reply.send(prices.info());
  });
  app.get('/sep38/prices', async (request, reply) => {
    if (!prices) return reply.code(503).send({code: 'PRICING_DISABLED', message: 'This deployment serves no rates'});
    const query = pricesQuerySchema.parse(request.query);
    // Rates are read by every open lira screen, so this is the limit a crowd
    // hits first. It is unauthenticated, so the address is all there is - the
    // ceiling is set for a room.
    priceLimiter.assert(`ip:${callerKey(request)}`);
    return reply.send(await prices.prices({sellAsset: query.sell_asset, sellAmount: query.sell_amount}));
  });
  app.post('/v1/auth/challenges', async (request, reply) => {
    if (!deviceAuth) return reply.code(503).send({code: 'AUTHENTICATION_DISABLED', message: 'Device authentication is unavailable'});
    const {publicSigner} = deviceAuthChallengeSchema.parse(request.body);
    const canonicalSigner = canonicalizeDevicePublicSigner(publicSigner);
    authenticationLimiter.assert(`device:${canonicalSigner}`);
    venueLimiter.assert(`ip:${callerKey(request)}`);
    return reply.code(201).send(await deviceAuth.challenge(canonicalSigner));
  });
  app.post('/v1/auth/sessions', async (request, reply) => {
    if (!deviceAuth) return reply.code(503).send({code: 'AUTHENTICATION_DISABLED', message: 'Device authentication is unavailable'});
    const input = deviceAuthSessionSchema.parse(request.body);
    authenticationLimiter.assert(`device:${canonicalizeDevicePublicSigner(input.publicSigner)}`);
    venueLimiter.assert(`ip:${callerKey(request)}`);
    return reply.code(201).send(await deviceAuth.createSession(input));
  });
  /**
   * What the service has handled. Read-only and free of anything that
   * identifies a person or a payment: counts by outcome and one duration, so it
   * can be watched by an operator or shown in a demo without exposing a
   * customer, a merchant or an amount.
   */
  app.get('/v1/metrics', async () => {
    const metrics = await intents.readMetrics();
    return {...metrics, storage};
  });

  app.get('/v1/health/stellar', async (_request, reply) => {
    try {
      return await stellar.health();
    } catch {
      return reply.code(503).send({code: 'STELLAR_UNAVAILABLE', message: 'Stellar RPC is unavailable'});
    }
  });
  app.addHook('onRequest', async (request, reply) => {
    const incoming = request.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && /^[A-Za-z0-9._:-]{1,96}$/.test(incoming)
      ? incoming
      : request.id;
    reply.header('x-request-id', requestId);
  });
  app.post('/v1/payment-intents', async (request, reply) => {
    const idempotencyKey = z.string().min(16).parse(request.headers['idempotency-key']);
    const payload = await authorizeMerchantIntent(request.body, request, authOptions);
    const stored = await intents.create(payload, idempotencyKey);
    await audit.record('payment_intent_created', stored.payload.intent.intentId, {
      actor: stored.payload.intent.merchantSigningKey,
      detail: {
        merchantProfileId: stored.payload.intent.merchantProfileId,
        amount: stored.payload.intent.amount,
        asset: stored.payload.intent.asset.code,
      },
    });
    return reply.code(201).send(stored);
  });
  app.post('/v1/merchant-profiles', async (request, reply) => {
    const principal = await requireAuthenticatedPrincipal(request, authOptions);
    const profile = await merchants.create(request.body, principal?.userId);
    await audit.record('merchant_profile_created', profile.id, {
      actor: profile.signingKey,
      detail: {recipient: profile.recipient, network: profile.network},
    });
    return reply.code(201).send(profile);
  });
  app.get('/v1/merchant-profiles/:merchantProfileId', async (request, reply) => {
    const {merchantProfileId} = profileParamsSchema.parse(request.params);
    const principal = await requireMerchantPrincipal(request, authOptions);
    const profile = await merchants.get(merchantProfileId);
    assertResourceOwnership(principal, profile.userId);
    return reply.send(profile);
  });
  app.get('/v1/relayer', async (_request, reply) => {
    return reply.send(relayerService.identity());
  });
  app.post('/v1/wallets', async (request, reply) => {
    const {devicePublicKey, recovery} = walletSchema.parse(request.body);
    const principal = await requireAuthenticatedPrincipal(request, authOptions);
    if (principal?.publicSigner && principal.publicSigner !== canonicalizeDevicePublicSigner(devicePublicKey)) {
      throw new CapabilityDeniedError('A device may only provision a wallet for its own key');
    }
    walletLimiter.assert(`device:${devicePublicKey}`);
    venueLimiter.assert(`ip:${callerKey(request)}`);
    const wallet = await walletService.provision(devicePublicKey, principal?.userId, recovery);
    if (!wallet.reused) {
      await audit.record('wallet_provisioned', wallet.walletContractId, {
        detail: {
          fundedAmount: wallet.fundedAmount,
          transactionHash: wallet.transactionHash,
          recoverySignerKind: recovery?.kind ?? 'none',
        },
      });
    }
    return reply.code(201).send(wallet);
  });
  /**
   * The wallet a passkey recovers.
   *
   * A replacement phone arrives knowing nothing: not the contract address, and
   * not the device key it has to rotate out. Both are already public on the
   * ledger - this only saves the phone from scanning for them, and holding the
   * credential is not what authorizes the rotation. The contract is: only the
   * registered recovery signer can call `rotate`, and only that.
   */
  app.post('/v1/wallets/recover', async (request, reply) => {
    const {credentialId} = walletRecoverySchema.parse(request.body);
    // Counted against the credential being presented rather than the address,
    // so one person recovering does not lock out everyone beside them.
    walletLimiter.assert(`credential:${credentialId}`);
    venueLimiter.assert(`ip:${callerKey(request)}`);
    const wallet = await walletService.findByRecoveryCredential(credentialId);
    if (!wallet) {
      return reply.code(404).send({
        error: 'WALLET_NOT_FOUND',
        message: 'No wallet is recoverable with that credential',
      });
    }
    return reply.send({
      walletContractId: wallet.contractAddress,
      retiredSigner: wallet.publicSigner,
      recoverySignerKind: wallet.recovery?.kind ?? 'Passkey',
    });
  });
  app.post('/v1/relayer/transactions', async (request, reply) => {
    const principal = await requireAuthenticatedPrincipal(request, authOptions);
    const {xdr} = relayerTransactionSchema.parse(request.body);
    // Every payment passes through here. Counted per device, because counting
    // per address would make a room of customers share thirty a minute.
    relayerLimiter.assert(limitKey(request, principal));
    venueLimiter.assert(`ip:${callerKey(request)}`);
    const signed = relayerService.signSettlementTransaction(xdr);
    await audit.record('relayer_signed_settlement', relayerService.identity().address);
    return reply.send(signed);
  });
  app.post('/v1/merchant-profiles/:merchantProfileId/registration', async (request, reply) => {
    const {merchantProfileId} = profileParamsSchema.parse(request.params);
    const principal = await requireMerchantPrincipal(request, authOptions);
    const profile = await merchants.get(merchantProfileId);
    assertResourceOwnership(principal, profile.userId);
    const registration = await relayerService.registerMerchant({
      merchantProfileId: profile.id,
      signingKey: profile.signingKey,
      recipient: profile.recipient,
    });
    await audit.record('merchant_registered_on_chain', profile.id, {
      actor: profile.signingKey,
      detail: {transactionHash: registration.transactionHash},
    });
    return reply.code(201).send(registration);
  });
  app.get('/v1/merchant-profiles/:merchantProfileId/payments', async (request, reply) => {
    const {merchantProfileId} = profileParamsSchema.parse(request.params);
    const principal = await requireMerchantPrincipal(request, authOptions);
    const profile = await merchants.get(merchantProfileId);
    assertResourceOwnership(principal, profile.userId);
    return reply.send({
      merchantProfileId: profile.id,
      payments: await intents.listMerchantPayments(profile.id),
    });
  });
  app.get('/v1/payment-intents/:intentId', async (request, reply) => {
    const {intentId} = paramsSchema.parse(request.params);
    const stored = await intents.get(intentId);
    return stored ?? reply.code(404).send({code: 'INTENT_NOT_FOUND', message: 'Payment intent not found'});
  });
  app.post('/v1/payment-intents/:intentId/authorize', async (request, reply) => {
    const {intentId} = paramsSchema.parse(request.params);
    const principal = await requireAuthenticatedPrincipal(request, authOptions);
    const authorization = authorizeSchema.parse(request.body);
    assertWalletOwnership(principal, authorization.authorizer);
    const settlement = await intents.authorize(intentId, authorization);
    await audit.record('payment_authorized', intentId, {actor: authorization.authorizer});
    return reply.send(settlement);
  });
  app.post('/v1/payment-intents/:intentId/submit', async (request, reply) => {
    const {intentId} = paramsSchema.parse(request.params);
    const principal = await requireAuthenticatedPrincipal(request, authOptions);
    if (principal) {
      const authorization = await intents.getAuthorization(intentId);
      if (!authorization) throw new SettlementInputError('The payment must be authorized before submission');
      assertWalletOwnership(principal, authorization.authorizer);
    }
    const {transactionHash} = submitSchema.parse(request.body);
    const settlement = await intents.submit(intentId, transactionHash);
    await audit.record('payment_submitted', intentId, {detail: {transactionHash}});
    return reply.send(settlement);
  });
  /**
   * The meeting point that lets two devices complete one payment.
   *
   * The settlement contract verifies a merchant signature over a digest that
   * names the payer, so the merchant cannot produce it in advance — it has to
   * learn who is paying first. A customer claims the request here; the merchant
   * device, which is the only place its signing key lives, leaves the signature
   * for the customer to collect.
   */
  app.post('/v1/payment-intents/:intentId/countersignature/request', async (request, reply) => {
    const {intentId} = paramsSchema.parse(request.params);
    const principal = await requireAuthenticatedPrincipal(request, authOptions);
    const {customerAddress} = countersignatureRequestSchema.parse(request.body);
    assertWalletOwnership(principal, customerAddress);
    const record = await intents.requestCountersignature(intentId, customerAddress);
    await audit.record('countersignature_requested', intentId, {actor: customerAddress});
    return reply.send(record);
  });

  app.post('/v1/payment-intents/:intentId/countersignature', async (request, reply) => {
    const {intentId} = paramsSchema.parse(request.params);
    const principal = await requireMerchantPrincipal(request, authOptions);
    const {customerAddress, signature} = countersignatureSchema.parse(request.body);
    const stored = await intents.get(intentId);
    if (!stored) throw new SettlementNotFoundError('Payment intent not found');
    if (principal && !principal.merchantProfileIds?.includes(stored.payload.intent.merchantProfileId)) {
      throw new CapabilityDeniedError('Merchant profile is not owned by the authenticated user');
    }
    const record = await intents.supplyCountersignature(intentId, customerAddress, signature);
    await audit.record('countersignature_supplied', intentId, {actor: customerAddress});
    return reply.send(record);
  });

  app.get('/v1/payment-intents/:intentId/countersignature', async (request, reply) => {
    const {intentId} = paramsSchema.parse(request.params);
    const record = await intents.getCountersignature(intentId);
    return record
      ? reply.send(record)
      : reply.code(404).send({code: 'COUNTERSIGNATURE_NOT_FOUND', message: 'No customer has asked to pay this request'});
  });

  app.get('/v1/payment-intents/:intentId/history', async (request, reply) => {
    const {intentId} = paramsSchema.parse(request.params);
    return reply.send({intentId, events: await audit.history(intentId)});
  });
  app.get('/v1/payment-intents/:intentId/authorization', async (request, reply) => {
    const {intentId} = paramsSchema.parse(request.params);
    const authorization = await intents.getAuthorization(intentId);
    return authorization ?? reply.code(404).send({code: 'AUTHORIZATION_NOT_FOUND', message: 'Authorization not found'});
  });
  app.get('/v1/payment-intents/:intentId/settlement', async (request, reply) => {
    const {intentId} = paramsSchema.parse(request.params);
    const settlement = await intents.getSettlement(intentId);
    return settlement ?? reply.code(404).send({code: 'SETTLEMENT_NOT_FOUND', message: 'Settlement not found'});
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({code: 'INVALID_REQUEST', message: 'Request validation failed', issues: error.issues});
    }
    if (error instanceof DeviceAuthenticationError) {
      return reply.code(401).send({code: error.code, message: error.message});
    }
    if (error instanceof PriceUnavailableError) {
      // No rate is a temporary state of the world, not a bad request: the
      // caller asked a reasonable question and the answer is not available.
      return reply.code(503).send({code: error.code, message: error.message});
    }
    if (error instanceof IntentConflictError) {
      return reply.code(409).send({code: 'INTENT_CONFLICT', message: error.message});
    }
    if (error instanceof SettlementNotFoundError) {
      // Asking about a payment that does not exist is the caller being wrong,
      // not the service failing; this used to fall through to a 500.
      return reply.code(404).send({code: 'INTENT_NOT_FOUND', message: error.message});
    }
    if (error instanceof CountersignatureConflictError) {
      return reply.code(409).send({code: 'COUNTERSIGNATURE_CONFLICT', message: error.message});
    }
    if (error instanceof CountersignatureNotFoundError) {
      return reply.code(404).send({code: 'COUNTERSIGNATURE_NOT_FOUND', message: error.message});
    }
    if (error instanceof SettlementInputError) {
      return reply.code(400).send({code: 'INVALID_SETTLEMENT', message: error.message});
    }
    if (error instanceof SettlementTransitionError) {
      return reply.code(409).send({code: 'INVALID_SETTLEMENT_TRANSITION', message: error.message});
    }
    if (error instanceof MerchantProfileInputError) {
      return reply.code(400).send({code: 'INVALID_MERCHANT_PROFILE', message: error.message});
    }
    if (error instanceof MerchantProfileConflictError) {
      return reply.code(409).send({code: 'MERCHANT_PROFILE_CONFLICT', message: error.message});
    }
    if (error instanceof MerchantProfileNotFoundError) {
      return reply.code(404).send({code: 'MERCHANT_PROFILE_NOT_FOUND', message: error.message});
    }
    if (error instanceof RateLimitError) {
      return reply
        .code(429)
        .header('retry-after', String(error.retryAfterSeconds))
        .send({code: 'RATE_LIMITED', message: 'Too many requests; try again shortly'});
    }
    if (error instanceof WalletProvisioningError) {
      const status = error.code === 'WALLET_PROVISIONING_DISABLED'
        ? 503
        : error.code === 'INVALID_DEVICE_KEY'
          ? 400
          : 502;
      return reply.code(status).send({code: error.code, message: error.message});
    }
    if (error instanceof RelayerError) {
      const status = error.code === 'RELAYER_DISABLED' || error.code === 'ADMIN_DISABLED' ? 503 : 400;
      return reply.code(status).send({code: error.code, message: error.message});
    }
    if (error instanceof AuthenticationRequiredError) {
      return reply.code(401).send({code: error.code, message: error.message});
    }
    if (error instanceof CapabilityDeniedError) {
      return reply.code(403).send({code: error.code, message: error.message});
    }
    app.log.error({err: error}, 'request_failed');
    return reply.code(500).send({code: 'INTERNAL_ERROR', message: 'The request could not be completed'});
  });

  return app;
}
