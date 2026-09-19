import {Keypair, Transaction, TransactionBuilder, Address, StrKey} from '@stellar/stellar-sdk';
import {basicNodeSigner} from '@stellar/stellar-sdk/contract';
import {createSettlementClient, settlementMerchantId, type StellarConfig} from '@rosapay/stellar';
import {Buffer} from 'node:buffer';

export type RelayerServiceOptions = {
  config: StellarConfig;
  relayerSecret?: string;
  adminSecret?: string;
};

export type RelayerIdentity = {
  address: string;
  network: StellarConfig['network'];
  networkPassphrase: string;
  settlementContractId: string;
};

export type MerchantRegistrationResult = {
  merchantProfileId: string;
  merchantId: string;
  transactionHash: string;
};

export class RelayerError extends Error {
  constructor(
    readonly code: 'RELAYER_DISABLED' | 'ADMIN_DISABLED' | 'INVALID_TRANSACTION' | 'REGISTRATION_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'RelayerError';
  }
}

/**
 * Pays the fee for settlements and registers merchants on-chain. The relayer
 * never holds customer keys and never blind-signs: it only signs a transaction
 * whose source is itself and whose single operation invokes one of the configured
 * settlement entry points on the configured settlement contract.
 */
export class RelayerService {
  private readonly relayer: Keypair | null;
  private readonly admin: Keypair | null;

  constructor(private readonly options: RelayerServiceOptions) {
    this.relayer = options.relayerSecret?.trim() ? Keypair.fromSecret(options.relayerSecret.trim()) : null;
    this.admin = options.adminSecret?.trim() ? Keypair.fromSecret(options.adminSecret.trim()) : null;
  }

  get enabled(): boolean {
    return this.relayer !== null && Boolean(this.options.config.settlementContractId);
  }

  identity(): RelayerIdentity {
    const relayer = this.requireRelayer();
    return {
      address: relayer.publicKey(),
      network: this.options.config.network,
      networkPassphrase: this.options.config.networkPassphrase,
      settlementContractId: this.requireContractId(),
    };
  }

  /** Verifies the envelope before adding the fee-payer signature. */
  signSettlementTransaction(transactionXdr: string): {signedXdr: string} {
    const relayer = this.requireRelayer();
    const contractId = this.requireContractId();

    let transaction: Transaction;
    try {
      const parsed = TransactionBuilder.fromXDR(transactionXdr, this.options.config.networkPassphrase);
      if (!(parsed instanceof Transaction)) {
        throw new RelayerError('INVALID_TRANSACTION', 'Fee bump transactions are not relayed');
      }
      transaction = parsed;
    } catch (error) {
      if (error instanceof RelayerError) throw error;
      throw new RelayerError('INVALID_TRANSACTION', 'The transaction envelope could not be parsed');
    }

    if (transaction.source !== relayer.publicKey()) {
      throw new RelayerError('INVALID_TRANSACTION', 'The relayer only signs transactions it is the source of');
    }
    if (transaction.operations.length !== 1) {
      throw new RelayerError('INVALID_TRANSACTION', 'A settlement transaction carries exactly one operation');
    }

    const invocation = readContractInvocation(transaction);
    if (invocation.contractId !== contractId) {
      throw new RelayerError('INVALID_TRANSACTION', 'The transaction does not invoke the settlement contract');
    }
    const allowedFunctions = new Set(['settle_payment', 'settle_payment_with_swap']);
    if (!allowedFunctions.has(invocation.functionName)) {
      throw new RelayerError('INVALID_TRANSACTION', `The relayer does not sign ${invocation.functionName}`);
    }

    transaction.sign(relayer);
    return {signedXdr: transaction.toXDR()};
  }

  /** Registers the merchant so the contract accepts requests signed by its key. */
  async registerMerchant(input: {
    merchantProfileId: string;
    signingKey: string;
    recipient: string;
  }): Promise<MerchantRegistrationResult> {
    const admin = this.admin;
    if (!admin) {
      throw new RelayerError('ADMIN_DISABLED', 'On-chain merchant registration is not configured');
    }
    if (!StrKey.isValidEd25519PublicKey(input.signingKey)) {
      throw new RelayerError('REGISTRATION_FAILED', 'The merchant signing key must be a Stellar G-address');
    }

    const merchantId = settlementMerchantId(input.merchantProfileId);
    const signer = basicNodeSigner(admin, this.options.config.networkPassphrase);
    const client = createSettlementClient(this.options.config, {
      publicKey: admin.publicKey(),
      signTransaction: signer.signTransaction,
    });
    const transaction = await client.register_merchant({
      merchant_id: merchantId,
      signing_key: Buffer.from(StrKey.decodeEd25519PublicKey(input.signingKey)),
      recipient: input.recipient,
    });
    const sent = await transaction.signAndSend({signTransaction: signer.signTransaction});
    const hash = sent.sendTransactionResponse?.hash;
    if (!hash) {
      throw new RelayerError('REGISTRATION_FAILED', 'Merchant registration was not submitted');
    }
    return {merchantProfileId: input.merchantProfileId, merchantId: merchantId.toString('hex'), transactionHash: hash};
  }

  private requireRelayer(): Keypair {
    if (!this.relayer) {
      throw new RelayerError('RELAYER_DISABLED', 'No relayer account is configured for this deployment');
    }
    return this.relayer;
  }

  private requireContractId(): string {
    const contractId = this.options.config.settlementContractId;
    if (!contractId) {
      throw new RelayerError('RELAYER_DISABLED', 'No settlement contract is configured for this deployment');
    }
    return contractId;
  }
}

function readContractInvocation(transaction: Transaction): {contractId: string; functionName: string} {
  const operation = transaction.operations[0];
  if (!operation || operation.type !== 'invokeHostFunction') {
    throw new RelayerError('INVALID_TRANSACTION', 'Only Soroban contract invocations are relayed');
  }
  try {
    const invokeContract = operation.func.invokeContract();
    return {
      contractId: Address.fromScAddress(invokeContract.contractAddress()).toString(),
      functionName: invokeContract.functionName().toString(),
    };
  } catch {
    throw new RelayerError('INVALID_TRANSACTION', 'Only contract function calls are relayed');
  }
}
