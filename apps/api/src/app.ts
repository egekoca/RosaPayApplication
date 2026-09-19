import Fastify from 'fastify';
import type {FastifyRequest} from 'fastify';
import {ZodError, z} from 'zod';
import {createStellarConfig, StellarRpcClient} from '@rosapay/stellar';
import {
  IntentConflictError,
  type IntentRepository,
  IntentService,
  SettlementInputError,
  SettlementTransitionError,
} from './application/IntentService';
import {
  ApiAuthOptions,
  assertResourceOwnership,
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
import {InMemoryIntentRepository} from './infrastructure/InMemoryIntentRepository';
import {InMemoryMerchantProfileRepository} from './infrastructure/InMemoryMerchantProfileRepository';

const paramsSchema = z.object({intentId: z.string().min(1)});
const profileParamsSchema = z.object({merchantProfileId: z.string().min(1)});
const relayerTransactionSchema = z.object({xdr: z.string().min(1).max(65_536)});
const authorizeSchema = z.object({
  authorizer: z.string().regex(/^[GC][A-Z2-7]{55}$/),
  authorizationHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  expiresAtLedger: z.number().int().positive().optional(),
});
const submitSchema = z.object({transactionHash: z.string().regex(/^[a-f0-9]{64}$/i)});
const walletSchema = z.object({devicePublicKey: z.string().min(64).max(512)});

export type BuildAppOptions = {
  repository?: IntentRepository;
  merchantProfiles?: MerchantProfileRepository;
  auth?: ApiAuthOptions;
  relayer?: RelayerService;
  wallets?: WalletProvisioningService;
};

export function buildApp({
  repository = new InMemoryIntentRepository(),
  merchantProfiles = new InMemoryMerchantProfileRepository(),
  auth,
  relayer,
  wallets,
}: BuildAppOptions = {}) {
  const app = Fastify({logger: {redact: ['req.headers.authorization', 'req.body.signature', 'req.body.authorization']}});
  const intents = new IntentService(repository);
  const merchants = new MerchantProfileService(merchantProfiles);
  const authOptions: ApiAuthOptions = auth ?? {required: process.env.API_AUTH_REQUIRED === 'true'};
  const stellarConfig = createStellarConfig(process.env.STELLAR_NETWORK ?? 'testnet', {
    rpcUrl: process.env.STELLAR_RPC_URL,
    settlementContractId: process.env.STELLAR_SETTLEMENT_CONTRACT_ID,
  });
  const stellar = new StellarRpcClient(stellarConfig);
  const walletService = wallets ?? new WalletProvisioningService({
    config: stellarConfig,
    ...(process.env.STELLAR_WALLET_WASM_HASH ? {walletWasmHash: process.env.STELLAR_WALLET_WASM_HASH} : {}),
    ...(process.env.STELLAR_ADMIN_SECRET ? {deployerSecret: process.env.STELLAR_ADMIN_SECRET} : {}),
    ...(process.env.STELLAR_WALLET_FUNDING ? {fundingAmount: process.env.STELLAR_WALLET_FUNDING} : {}),
  });
  const relayerService = relayer ?? new RelayerService({
    config: stellarConfig,
    ...(process.env.STELLAR_RELAYER_SECRET ? {relayerSecret: process.env.STELLAR_RELAYER_SECRET} : {}),
    ...(process.env.STELLAR_ADMIN_SECRET ? {adminSecret: process.env.STELLAR_ADMIN_SECRET} : {}),
  });

  app.get('/v1/health', async () => ({status: 'ok'}));
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
    return reply.code(201).send(stored);
  });
  app.post('/v1/merchant-profiles', async (request, reply) => {
    const principal = await requireMerchantPrincipal(request, authOptions);
    const profile = await merchants.create(request.body, principal?.userId);
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
    const {devicePublicKey} = walletSchema.parse(request.body);
    await requireAuthenticatedPrincipal(request, authOptions);
    const wallet = await walletService.provision(devicePublicKey);
    return reply.code(201).send(wallet);
  });
  app.post('/v1/relayer/transactions', async (request, reply) => {
    const {xdr} = relayerTransactionSchema.parse(request.body);
    return reply.send(relayerService.signSettlementTransaction(xdr));
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
    return reply.code(201).send(registration);
  });
  app.get('/v1/payment-intents/:intentId', async (request, reply) => {
    const {intentId} = paramsSchema.parse(request.params);
    const stored = await intents.get(intentId);
    return stored ?? reply.code(404).send({code: 'INTENT_NOT_FOUND', message: 'Payment intent not found'});
  });
  app.post('/v1/payment-intents/:intentId/authorize', async (request, reply) => {
    const {intentId} = paramsSchema.parse(request.params);
    await requireAuthenticatedPrincipal(request, authOptions);
    const settlement = await intents.authorize(intentId, authorizeSchema.parse(request.body));
    return reply.send(settlement);
  });
  app.post('/v1/payment-intents/:intentId/submit', async (request, reply) => {
    const {intentId} = paramsSchema.parse(request.params);
    await requireAuthenticatedPrincipal(request, authOptions);
    const {transactionHash} = submitSchema.parse(request.body);
    const settlement = await intents.submit(intentId, transactionHash);
    return reply.send(settlement);
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
    if (error instanceof IntentConflictError) {
      return reply.code(409).send({code: 'INTENT_CONFLICT', message: error.message});
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
