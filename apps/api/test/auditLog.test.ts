import {afterEach, describe, expect, it} from 'vitest';
import {AuditLog, InMemoryAuditLog} from '../src/application/AuditLog';
import {buildApp} from '../src/app';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(app => app.close())));

const customer = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const transactionHash = 'a'.repeat(64);

function signedIntent(intentId = '01K36YB37NXM4X4TECF0VKP1M9') {
  return {
    intent: {
      version: 'RTP/1',
      intentId,
      network: 'testnet',
      merchantProfileId: '01K36YATYFVQBPR08G2YT29C3S',
      merchantName: 'Rose Coffee',
      merchantSigningKey: customer,
      recipient: customer,
      asset: {type: 'native', code: 'XLM', decimals: 7},
      amount: '2.5',
      reference: 'Table 08',
      nonce: 'b9cdb790ee6a4d04a83763c018f532a8',
      expiresAtLedger: 1_500_120,
      createdAt: '2026-08-23T00:00:00.000Z',
    },
    signature: 'signed-intent-fixture',
  };
}

describe('audit log', () => {
  it('never stores anything that names a secret', async () => {
    const repository = new InMemoryAuditLog();
    const log = new AuditLog(repository);

    await log.record('payment_authorized', 'intent-1', {
      actor: customer,
      detail: {
        transactionHash,
        // These must not survive, whatever a caller passes.
        signature: 'deadbeef',
        developmentSigningSecret: 'nope',
        privateKey: 'nope',
      } as never,
    });

    const [event] = await repository.listForSubject('intent-1', 10);
    expect(event?.detail).toEqual({transactionHash});
    expect(JSON.stringify(event)).not.toContain('deadbeef');
  });

  it('refuses an event with no subject', async () => {
    const log = new AuditLog(new InMemoryAuditLog());
    await expect(log.record('payment_submitted', '  ')).rejects.toThrow('needs a subject');
  });

  it('reads back the trail of a payment, newest first', async () => {
    const app = buildApp();
    apps.push(app);
    const payload = signedIntent();
    const intentId = payload.intent.intentId;

    await app.inject({
      method: 'POST',
      url: '/v1/payment-intents',
      headers: {'idempotency-key': 'audit-key-000001'},
      payload,
    });
    await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/authorize`,
      payload: {authorizer: customer},
    });
    await app.inject({
      method: 'POST',
      url: `/v1/payment-intents/${intentId}/submit`,
      payload: {transactionHash},
    });

    const history = await app.inject({method: 'GET', url: `/v1/payment-intents/${intentId}/history`});
    expect(history.statusCode).toBe(200);
    expect(history.json().events.map((event: {event: string}) => event.event)).toEqual([
      'payment_submitted',
      'payment_authorized',
      'payment_intent_created',
    ]);
    expect(history.json().events[1]).toMatchObject({actor: customer});
  });

  it('reports an empty trail for a payment that never happened', async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject({method: 'GET', url: '/v1/payment-intents/unknown/history'});
    expect(response.statusCode).toBe(200);
    expect(response.json().events).toEqual([]);
  });
});
