import type {xdr} from '@stellar/stellar-sdk';
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
  /** Re-runs simulation, which contract-account authorization needs. */
  simulate?(options?: {restore?: boolean}): Promise<unknown>;
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

export type WalletAuthorizeEntry = (
  entry: xdr.SorobanAuthorizationEntry,
  signer: unknown,
  validUntilLedger: number,
  networkPassphrase?: string,
) => Promise<xdr.SorobanAuthorizationEntry>;

export type SettlementPipelineInput = {
  client: SettlementPipelineClient;
  intent: ContractPaymentIntent;
  merchantSignature: Buffer;
  customerSigner: SettlementPipelineSigner;
  /** Contract accounts authorize the whole entry rather than a preimage. */
  customerAuthorizeEntry?: WalletAuthorizeEntry;
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
    // The generated client types only describe the classic-account path, so the
    // contract-account variant is passed through with an explicit cast.
    const signOptions = input.customerAuthorizeEntry
      ? {address, authorizeEntry: input.customerAuthorizeEntry}
      : {address, signAuthEntry: input.customerSigner.signAuthEntry};
    await transaction.signAuthEntries(signOptions as Parameters<typeof transaction.signAuthEntries>[0]);
  }
  if (input.customerAuthorizeEntry) {
    // A contract account only reads its signer during `__check_auth`, which the
    // first simulation never runs. Simulating again with the signed entries in
    // place puts that read into the footprint; without it the ledger rejects the
    // transaction for touching data outside it.
    await transaction.simulate?.({restore: true});
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
