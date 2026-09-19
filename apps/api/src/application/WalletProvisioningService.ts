import {
  Address,
  Asset,
  Contract,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import {uncompressedPointFromSpki} from '@rosapay/secure-signer';
import type {StellarConfig} from '@rosapay/stellar';
import {Buffer} from 'node:buffer';
import {randomBytes} from 'node:crypto';

export type WalletProvisioningOptions = {
  config: StellarConfig;
  walletWasmHash?: string;
  deployerSecret?: string;
  /** Starting balance so a new wallet can pay before it ever receives funds. */
  fundingAmount?: string;
};

export type ProvisionedWallet = {
  walletContractId: string;
  devicePublicKey: string;
  transactionHash: string;
  fundedAmount: string;
};

export class WalletProvisioningError extends Error {
  constructor(
    readonly code: 'WALLET_PROVISIONING_DISABLED' | 'INVALID_DEVICE_KEY' | 'WALLET_PROVISIONING_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'WalletProvisioningError';
  }
}

/**
 * Deploys a customer's smart wallet and gives it a starting balance. The device
 * key is the only signer, so the deployer can create the account but can never
 * spend from it.
 */
export class WalletProvisioningService {
  private readonly deployer: Keypair | null;

  constructor(private readonly options: WalletProvisioningOptions) {
    this.deployer = options.deployerSecret?.trim() ? Keypair.fromSecret(options.deployerSecret.trim()) : null;
  }

  get enabled(): boolean {
    return this.deployer !== null && Boolean(this.options.walletWasmHash);
  }

  async provision(devicePublicKeyBase64: string): Promise<ProvisionedWallet> {
    const deployer = this.deployer;
    const wasmHash = this.options.walletWasmHash;
    if (!deployer || !wasmHash) {
      throw new WalletProvisioningError(
        'WALLET_PROVISIONING_DISABLED',
        'This deployment cannot create smart wallets',
      );
    }

    let devicePoint: Buffer;
    try {
      devicePoint = Buffer.from(
        uncompressedPointFromSpki(Uint8Array.from(Buffer.from(devicePublicKeyBase64, 'base64'))),
      );
    } catch {
      throw new WalletProvisioningError('INVALID_DEVICE_KEY', 'The device key is not an uncompressed secp256r1 point');
    }

    const server = new rpc.Server(this.options.config.rpcUrl);
    const source = await server.getAccount(deployer.publicKey());
    const deployment = new TransactionBuilder(source, {
      fee: '3000000',
      networkPassphrase: this.options.config.networkPassphrase,
    })
      .addOperation(
        Operation.createCustomContract({
          address: Address.fromString(deployer.publicKey()),
          wasmHash: Buffer.from(wasmHash, 'hex'),
          salt: randomBytes(32),
          constructorArgs: [xdr.ScVal.scvBytes(devicePoint), xdr.ScVal.scvVoid()],
        }),
      )
      .setTimeout(60)
      .build();

    const prepared = await server.prepareTransaction(deployment);
    prepared.sign(deployer);
    const sent = await server.sendTransaction(prepared);
    if (sent.status === 'ERROR') {
      throw new WalletProvisioningError('WALLET_PROVISIONING_FAILED', 'The wallet deployment was rejected');
    }
    const confirmed = await server.pollTransaction(sent.hash, {attempts: 20});
    if (confirmed.status !== 'SUCCESS' || !confirmed.returnValue) {
      throw new WalletProvisioningError('WALLET_PROVISIONING_FAILED', `Wallet deployment failed: ${confirmed.status}`);
    }

    const walletContractId = Address.fromScVal(confirmed.returnValue).toString();
    if (!StrKey.isValidContract(walletContractId)) {
      throw new WalletProvisioningError('WALLET_PROVISIONING_FAILED', 'The deployment did not return a contract address');
    }

    const fundedAmount = this.options.fundingAmount ?? '25';
    await this.fund(server, deployer, walletContractId, fundedAmount);

    return {
      walletContractId,
      devicePublicKey: devicePoint.toString('base64'),
      transactionHash: sent.hash,
      fundedAmount,
    };
  }

  /** Sends the starting balance through the native asset contract. */
  private async fund(
    server: rpc.Server,
    deployer: Keypair,
    walletContractId: string,
    amount: string,
  ): Promise<void> {
    const nativeContract = new Contract(Asset.native().contractId(this.options.config.networkPassphrase));
    const stroops = BigInt(Math.round(Number(amount) * 10_000_000));
    const source = await server.getAccount(deployer.publicKey());
    const transfer = new TransactionBuilder(source, {
      fee: '2000000',
      networkPassphrase: this.options.config.networkPassphrase,
    })
      .addOperation(
        nativeContract.call(
          'transfer',
          Address.fromString(deployer.publicKey()).toScVal(),
          Address.fromString(walletContractId).toScVal(),
          nativeToScVal(stroops, {type: 'i128'}),
        ),
      )
      .setTimeout(60)
      .build();

    const prepared = await server.prepareTransaction(transfer);
    prepared.sign(deployer);
    const sent = await server.sendTransaction(prepared);
    if (sent.status === 'ERROR') {
      throw new WalletProvisioningError('WALLET_PROVISIONING_FAILED', 'The wallet could not be funded');
    }
    const confirmed = await server.pollTransaction(sent.hash, {attempts: 20});
    if (confirmed.status !== 'SUCCESS') {
      throw new WalletProvisioningError('WALLET_PROVISIONING_FAILED', `Funding failed: ${confirmed.status}`);
    }
  }
}
