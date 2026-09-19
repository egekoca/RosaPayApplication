import Fastify from 'fastify';
import {ZodError, z} from 'zod';
import {createStellarConfig, StellarRpcClient} from '@rosapay/stellar';
import {
  IntentConflictError,
  type IntentRepository,
  IntentService,
  SettlementInputError,
  SettlementTransitionError,
} from './application/IntentService';
import {InMemoryIntentRepository} from './infrastructure/InMemoryIntentRepository';

const paramsSchema = z.object({intentId: z.string().min(1)});

export type BuildAppOptions = {
  repository?: IntentRepository;
};

export function buildApp({repository = new InMemoryIntentRepository()}: BuildAppOptions = {}) {
  const app = Fastify({logger: {redact: ['req.headers.authorization', 'req.body.signature', 'req.body.authorization']}});
  const intents = new IntentService(repository);
  const stellar = new StellarRpcClient(createStellarConfig(process.env.STELLAR_NETWORK ?? 'testnet', {
    rpcUrl: process.env.STELLAR_RPC_URL,
    settlementContractId: process.env.STELLAR_SETTLEMENT_CONTRACT_ID,
  }));

  app.get('/v1/health', async () => ({status: 'ok'}));
  app.get('/v1/health/stellar', async (_request, reply) => {
    try {
      return await stellar.health();
    } catch {
      return reply.code(503).send({code: 'STELLAR_UNAVAILABLE', message: 'Stellar RPC is unavailable'});
    }
  });
  app.post('/v1/payment-intents', async (request, reply) => {
    const idempotencyKey = z.string().min(16).parse(request.headers['idempotency-key']);
    const stored = await intents.create(request.body, idempotencyKey);
    return reply.code(201).send(stored);
  });
  app.get('/v1/payment-intents/:intentId', async (request, reply) => {
    const {intentId} = paramsSchema.parse(request.params);
    const stored = await intents.get(intentId);
    return stored ?? reply.code(404).send({code: 'INTENT_NOT_FOUND', message: 'Payment intent not found'});
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
    app.log.error({err: error}, 'request_failed');
    return reply.code(500).send({code: 'INTERNAL_ERROR', message: 'The request could not be completed'});
  });

  return app;
}
