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
  settle_payment_with_swap?(
    args: {
      intent: ContractPaymentIntent;
      merchant_signature: Buffer;
      path: string[];
      amount_in_max: bigint;
      deadline: bigint;
    },
    options?: MethodOptions,
  ): Promise<SettlementPipelineTransaction>;
};

/**
 * How the customer pays for an intent they cannot fund directly.
 *
 * None of this reaches the merchant's signature. The contract is handed the
 * same intent either way and told an exact output, so the funding choice can
 * change what the customer spends and never what the merchant receives.
 */
export type SettlementFunding = {
  /** Input token first, the merchant's token last. */
  path: string[];
  /** The ceiling the router refuses to spend above. */
  amountInMax: bigint;
  /** Unix seconds after which the router will not execute the swap. */
  deadline: bigint;
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
  customerSigner?: SettlementPipelineSigner;
  /** Contract accounts authorize the whole entry rather than a preimage. */
  customerAuthorizeEntry?: WalletAuthorizeEntry;
  relayerSigner: SettlementRelayerSigner;
  /** Present only when the customer is paying from a different token. */
  funding?: SettlementFunding;
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
    readonly code:
      | 'CUSTOMER_AUTH_REQUIRED'
      | 'SUBMISSION_FAILED'
      | 'CONFIRMATION_FAILED'
      | 'SWAP_UNSUPPORTED',
    message: string,
  ) {
    super(message);
  }
}

/** Simulate, authorize, submit and wait for a Soroban settlement call. */
export async function settlePayment(input: SettlementPipelineInput): Promise<SettlementPipelineReceipt> {
  const transaction = await buildSettlementCall(input);
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
    if (!input.customerAuthorizeEntry && !input.customerSigner) {
      throw new SettlementPipelineError(
        'CUSTOMER_AUTH_REQUIRED',
        'Settlement needs either a contract-account authorizer or a classic signer',
      );
    }
    const signOptions = input.customerAuthorizeEntry
      ? {address, authorizeEntry: input.customerAuthorizeEntry}
      : {address, signAuthEntry: input.customerSigner!.signAuthEntry};
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

/**
 * The direct call and the funded one differ only in their arguments; everything
 * after simulation - authorization, submission, confirmation - is identical,
 * because from the contract's side they end in the same transfer.
 */
async function buildSettlementCall(
  input: SettlementPipelineInput,
): Promise<SettlementPipelineTransaction> {
  if (!input.funding) {
    return input.client.settle_payment(
      {intent: input.intent, merchant_signature: input.merchantSignature},
      {simulate: true},
    );
  }
  if (!input.client.settle_payment_with_swap) {
    throw new SettlementPipelineError(
      'SWAP_UNSUPPORTED',
      'This settlement contract has no funding-swap entry point',
    );
  }
  return input.client.settle_payment_with_swap(
    {
      intent: input.intent,
      merchant_signature: input.merchantSignature,
      path: input.funding.path,
      amount_in_max: input.funding.amountInMax,
      deadline: input.funding.deadline,
    },
    {simulate: true},
  );
}
