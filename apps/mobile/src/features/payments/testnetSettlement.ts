import {Keypair} from '@stellar/stellar-sdk';
import {basicNodeSigner} from '@stellar/stellar-sdk/contract';
import {Buffer} from 'buffer';
import type {SignedPaymentIntentV1, RandomBytes} from '@rosapay/protocol';
import {sign as signEd25519} from '@noble/ed25519';
import {
  buildSettlementEnvelope,
  createSettlementClient,
  settleSignedPayment,
  type SettlementPipelineProgress,
  type StellarConfig,
} from '@rosapay/stellar';
import type {MerchantProfile} from '../merchant/merchantProfile';

export type RelayerIdentity = {
  address: string;
  network: string;
  networkPassphrase: string;
  settlementContractId: string;
};

export class TestnetSettlementError extends Error {
  override readonly name = 'TestnetSettlementError';

  constructor(
    readonly code:
      | 'RELAYER_UNAVAILABLE'
      | 'MERCHANT_KEY_UNAVAILABLE'
      | 'CUSTOMER_ACCOUNT_UNAVAILABLE'
      | 'SETTLEMENT_FAILED',
    message: string,
  ) {
    super(message);
  }
}

/** Reads the relayer that will pay the fee; the app never learns its secret. */
export async function fetchRelayerIdentity(baseUrl: string, fetcher: typeof fetch = fetch): Promise<RelayerIdentity> {
  let response: Response;
  try {
    response = await fetcher(`${baseUrl}/v1/relayer`);
  } catch {
    throw new TestnetSettlementError('RELAYER_UNAVAILABLE', 'The Rosa Pay relayer could not be reached');
  }
  if (!response.ok) {
    throw new TestnetSettlementError('RELAYER_UNAVAILABLE', 'The relayer is not configured for this deployment');
  }
  return (await response.json()) as RelayerIdentity;
}

/** Asks the relayer to add the fee-payer signature; it verifies the envelope itself. */
export function createRemoteRelayerSigner(baseUrl: string, fetcher: typeof fetch = fetch) {
  return {
    async signTransaction(xdr: string) {
      const response = await fetcher(`${baseUrl}/v1/relayer/transactions`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({xdr}),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {message?: string};
        throw new TestnetSettlementError('RELAYER_UNAVAILABLE', body.message ?? 'The relayer refused to sign this transaction');
      }
      const {signedXdr} = (await response.json()) as {signedXdr: string};
      return {signedTxXdr: signedXdr};
    },
  };
}

/**
 * Development customer wallet. The native signer is the real path; until it
 * exists this key stands in for it so the Testnet flow can be exercised, and it
 * is created from the same explicit randomness source as the merchant key.
 */
export function createDevelopmentCustomerKeypair(randomBytes: RandomBytes): Keypair {
  return Keypair.fromRawEd25519Seed(Buffer.from(randomBytes(32)));
}

/** Funds a brand new Testnet account so it can hold and send XLM. */
export async function fundTestnetAccount(
  config: StellarConfig,
  address: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!config.friendbotUrl) {
    throw new TestnetSettlementError('CUSTOMER_ACCOUNT_UNAVAILABLE', 'This network has no friendbot to fund accounts');
  }
  const response = await fetcher(`${config.friendbotUrl}?addr=${encodeURIComponent(address)}`);
  if (!response.ok && response.status !== 400) {
    throw new TestnetSettlementError('CUSTOMER_ACCOUNT_UNAVAILABLE', 'The Testnet account could not be funded');
  }
}

export type TestnetSettlementInput = {
  payload: SignedPaymentIntentV1;
  config: StellarConfig;
  merchantProfile: MerchantProfile;
  customer: Keypair;
  relayer: RelayerIdentity;
  relayerSigner: {signTransaction(xdr: string): Promise<{signedTxXdr: string}>};
  latestLedger: number;
  onProgress?: (progress: SettlementPipelineProgress) => void;
};

/**
 * Runs the relayed settlement: the customer signs only the authorization entry
 * for this exact invocation, and the relayer is the transaction source and fee
 * payer. The merchant's contract-digest signature covers the customer address,
 * so it can only be produced once the payer is known.
 */
export async function settleOnTestnet(input: TestnetSettlementInput) {
  const {intent} = input.payload;
  if (intent.merchantSigningKey !== input.merchantProfile.signingKey) {
    throw new TestnetSettlementError(
      'MERCHANT_KEY_UNAVAILABLE',
      'This request was signed by another device, so its merchant contract signature cannot be produced here',
    );
  }

  const envelope = buildSettlementEnvelope(intent, {
    customer: input.customer.publicKey(),
    networkPassphrase: input.config.networkPassphrase,
    settlementContractId: input.relayer.settlementContractId,
  });
  const digestClient = createSettlementClient(
    {...input.config, settlementContractId: input.relayer.settlementContractId},
    {publicKey: input.relayer.address},
  );
  const digest = (await digestClient.intent_digest({intent: envelope.intent}, {simulate: true})).result;
  const merchantContractSignature = await signEd25519(
    Uint8Array.from(digest),
    input.merchantProfile.developmentSigningSecret,
  );
  const customerSigner = basicNodeSigner(input.customer, input.config.networkPassphrase);

  return settleSignedPayment({
    payload: input.payload,
    config: {...input.config, settlementContractId: input.relayer.settlementContractId},
    customerAddress: input.customer.publicKey(),
    relayerAddress: input.relayer.address,
    latestLedger: input.latestLedger,
    merchantContractSignature,
    customerSigner: {signAuthEntry: customerSigner.signAuthEntry},
    relayerSigner: input.relayerSigner,
    ...(input.onProgress ? {onProgress: input.onProgress} : {}),
  });
}
