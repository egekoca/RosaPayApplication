import type {SettlementPipelineProgress} from '@rosapay/stellar';
import {RosaPayApiClient} from '../../api';
import {useAppStore} from '../../state/appStore';
import {logger} from '../../shared/logger';

export type LifecycleReporter = {
  record(progress: SettlementPipelineProgress): void;
  flush(): Promise<void>;
};

/**
 * Mirrors the settlement into the API as it happens, so the merchant and the
 * reconciliation worker see the same payment the customer just made. Reporting
 * is best effort and strictly ordered: the chain already holds the truth, so a
 * failed report is logged and never fails the payment.
 */
export function createLifecycleReporter(
  intentId: string,
  authorizer: string,
  client: RosaPayApiClient = new RosaPayApiClient({baseUrl: useAppStore.getState().apiBaseUrl}),
): LifecycleReporter {
  let chain = Promise.resolve();

  const enqueue = (event: string, work: () => Promise<unknown>) => {
    chain = chain.then(async () => {
      try {
        await work();
      } catch (error) {
        logger.error('payment_lifecycle_not_recorded', {
          event,
          intentId,
          message: error instanceof Error ? error.message : 'unknown error',
        });
      }
    });
  };

  return {
    record(progress) {
      if (progress.stage === 'authorized') {
        enqueue('authorize', () => client.authorizePayment(intentId, {authorizer}));
      }
      if (progress.stage === 'submitted' && progress.transactionHash) {
        const transactionHash = progress.transactionHash;
        enqueue('submit', () => client.submitPayment(intentId, transactionHash));
      }
    },
    flush: () => chain,
  };
}
