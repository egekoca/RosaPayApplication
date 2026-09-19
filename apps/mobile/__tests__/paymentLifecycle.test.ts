import {RosaPayApiClient} from '../src/api';
import {createLifecycleReporter} from '../src/features/payments/paymentLifecycle';

const intentId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const authorizer = 'GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57';
const transactionHash = 'a'.repeat(64);

function fakeClient(options: {failSubmit?: boolean} = {}) {
  const calls: string[] = [];
  const client = {
    calls,
    async authorizePayment(id: string, authorization: {authorizer: string}) {
      calls.push(`authorize:${id}:${authorization.authorizer}`);
      return {intentId: id, status: 'authorized' as const};
    },
    async submitPayment(id: string, hash: string) {
      calls.push(`submit:${id}:${hash}`);
      if (options.failSubmit) throw new Error('api down');
      return {intentId: id, status: 'submitted' as const};
    },
  };
  return client as unknown as RosaPayApiClient & {calls: string[]};
}

describe('payment lifecycle reporting', () => {
  it('records the authorization and the submitted transaction in order', async () => {
    const client = fakeClient();
    const reporter = createLifecycleReporter(intentId, authorizer, client);

    reporter.record({stage: 'simulated'});
    reporter.record({stage: 'authorized'});
    reporter.record({stage: 'submitted', transactionHash});
    reporter.record({stage: 'confirmed', transactionHash, ledger: 42});
    await reporter.flush();

    expect(client.calls).toEqual([
      `authorize:${intentId}:${authorizer}`,
      `submit:${intentId}:${transactionHash}`,
    ]);
  });

  it('never fails a settled payment when the API is unreachable', async () => {
    const client = fakeClient({failSubmit: true});
    const reporter = createLifecycleReporter(intentId, authorizer, client);

    reporter.record({stage: 'authorized'});
    reporter.record({stage: 'submitted', transactionHash});

    await expect(reporter.flush()).resolves.toBeUndefined();
  });

  it('ignores a submitted stage that carries no transaction hash', async () => {
    const client = fakeClient();
    const reporter = createLifecycleReporter(intentId, authorizer, client);

    reporter.record({stage: 'submitted'});
    await reporter.flush();

    expect(client.calls).toEqual([]);
  });
});
