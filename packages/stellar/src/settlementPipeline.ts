import type {SignAuthEntry, SignTransaction} from '@stellar/stellar-sdk/contract';
import type {MethodOptions} from '@stellar/stellar-sdk/contract';

import type {PaymentIntent as ContractPaymentIntent} from './generated/settlement';

export type SettlementPipelineStage = 'simulated' | 'authorized' | 'submitted' | 'confirmed';

export type SettlementPipelineProgress = {
  stage: SettlementPipelineStage;
  transactionHash?: string;
  ledger?: number;
};

export type SettlementPipelineSigner = {signAuthEntry: SignAuthEntry};
export type SettlementRelayerSigner = {signTransaction: SignTransaction};

export type SettlementPipelineTransaction = {
  result: unknown;
  needsNonInvokerSigningBy(): string[];
  signAuthEntries(options: {address: string; signAuthEntry: SignAuthEntry}): Promise<void>;
  signAndSend(options: {
    signTransaction: SignTransaction;
    watcher?: {
      onSubmitted?(response?: {status: string; hash: string}): void;
      onProgress?(response?: {status: string; txHash: string; ledger?: number}): void;
    };
  }): Promise<SettlementPipelineSentTransaction>;
};

export type SettlementPipelineClient = {
  settle_payment(
    args: {intent: ContractPaymentIntent; merchant_signature: Buffer},
    options?: MethodOptions,
  ): Promise<SettlementPipelineTransaction>;
};

export type SettlementPipelineSentTransaction = {
  result: unknown;
  sendTransactionResponse?: {status: string; hash: string};
  getTransactionResponse?: {status: string; txHash: string; ledger?: number};
};

export type SettlementPipelineInput = {
  client: SettlementPipelineClient;
  intent: ContractPaymentIntent;
  merchantSignature: Buffer;
  customerSigner: SettlementPipelineSigner;
  relayerSigner: SettlementRelayerSigner;
  onProgress?(progress: SettlementPipelineProgress): void;
};

export type SettlementPipelineReceipt = {
  transactionHash: string;
  ledger: number;
  result: unknown;
};

export class SettlementPipelineError extends Error {
  override readonly name = 'SettlementPipelineError';

  constructor(
    readonly code: 'CUSTOMER_AUTH_REQUIRED' | 'SUBMISSION_FAILED' | 'CONFIRMATION_FAILED',
    message: string,
  ) {
    super(message);
  }
}

/** Simulate, authorize, submit and wait for a Soroban settlement call. */
export async function settlePayment(input: SettlementPipelineInput): Promise<SettlementPipelineReceipt> {
  const transaction = await input.client.settle_payment(
    {intent: input.intent, merchant_signature: input.merchantSignature},
    {simulate: true},
  );
  input.onProgress?.({stage: 'simulated'});

  const requiredCustomerSigners = transaction.needsNonInvokerSigningBy();
  if (requiredCustomerSigners.length === 0) {
    throw new SettlementPipelineError(
      'CUSTOMER_AUTH_REQUIRED',
      'Settlement simulation did not produce a customer authorization entry',
    );
  }

  for (const address of requiredCustomerSigners) {
    await transaction.signAuthEntries({address, signAuthEntry: input.customerSigner.signAuthEntry});
  }
  input.onProgress?.({stage: 'authorized'});

  let submittedReported = false;
  const sent = await transaction.signAndSend({
    signTransaction: input.relayerSigner.signTransaction,
    watcher: {
      onSubmitted: response => {
        if (response?.hash) {
          submittedReported = true;
          input.onProgress?.({stage: 'submitted', transactionHash: response.hash});
        }
      },
    },
  });

  const submission = sent.sendTransactionResponse;
  if (!submission || (submission.status !== 'PENDING' && submission.status !== 'DUPLICATE')) {
    throw new SettlementPipelineError(
      'SUBMISSION_FAILED',
      `Settlement submission failed${submission?.status ? `: ${submission.status}` : ''}`,
    );
  }
  if (!submittedReported) input.onProgress?.({stage: 'submitted', transactionHash: submission.hash});

  const confirmation = sent.getTransactionResponse;
  if (!confirmation || confirmation.status !== 'SUCCESS' || confirmation.ledger === undefined) {
    throw new SettlementPipelineError(
      'CONFIRMATION_FAILED',
      `Settlement confirmation failed${confirmation?.status ? `: ${confirmation.status}` : ''}`,
    );
  }

  input.onProgress?.({stage: 'confirmed', transactionHash: confirmation.txHash, ledger: confirmation.ledger});
  return {transactionHash: confirmation.txHash, ledger: confirmation.ledger, result: sent.result};
}
