import {StrKey} from '@stellar/stellar-sdk';
import {createWalletAuthorizeEntry, type HardwareDigestSigner} from '@rosapay/stellar';
import type {SignedPaymentIntentV1} from '@rosapay/protocol';
import {
  buildSettlementEnvelope,
  createSettlementClient,
  settleSignedPayment,
  type SettlementFunding,
  type SettlementPipelineProgress,
  type SettlementPipelineSigner,
  type StellarConfig,
} from '@rosapay/stellar';
import type {Countersigner} from './countersignature';
import {useAppStore} from '../../state/appStore';

export type RelayerIdentity = {
  address: string;
  network: StellarConfig['network'];
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
      | 'RELAYER_MISMATCH'
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
  const body = (await response.json().catch(() => null)) as Partial<RelayerIdentity> | null;
  if (!body || !isRelayerIdentity(body)) {
    throw new TestnetSettlementError('RELAYER_UNAVAILABLE', 'The relayer returned an invalid deployment identity');
  }
  return body;
}

/**
 * Binds the API's fee payer to the app's configured network and contract.
 * Without this check an incorrect or compromised API could make the customer
 * authorize a call against a different settlement contract.
 */
export function assertRelayerIdentity(config: StellarConfig, relayer: RelayerIdentity): void {
  if (
    !StrKey.isValidEd25519PublicKey(relayer.address) ||
    !StrKey.isValidContract(relayer.settlementContractId) ||
    !config.settlementContractId ||
    relayer.network !== config.network ||
    relayer.networkPassphrase !== config.networkPassphrase ||
    relayer.settlementContractId !== config.settlementContractId
  ) {
    throw new TestnetSettlementError(
      'RELAYER_MISMATCH',
      'The relayer identity does not match this Testnet deployment',
    );
  }
}

function isRelayerIdentity(value: Partial<RelayerIdentity>): value is RelayerIdentity {
  return (
    typeof value.address === 'string' &&
    typeof value.network === 'string' &&
    (value.network === 'testnet' || value.network === 'pubnet' || value.network === 'local') &&
    typeof value.networkPassphrase === 'string' &&
    typeof value.settlementContractId === 'string' &&
    StrKey.isValidEd25519PublicKey(value.address) &&
    StrKey.isValidContract(value.settlementContractId)
  );
}

/** Asks the relayer to add the fee-payer signature; it verifies the envelope itself. */
export function createRemoteRelayerSigner(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
  options: {getToken?: () => string | undefined} = {},
) {
  return {
    async signTransaction(xdr: string) {
      const token = options.getToken?.() ?? useAppStore.getState().apiSession?.token;
      const response = await fetcher(`${baseUrl}/v1/relayer/transactions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? {authorization: `Bearer ${token}`} : {}),
        },
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
 * The account paying, and how it proves it.
 *
 * The two are genuinely different signatures, not two ways of writing one. A
 * contract account authorizes the whole entry, because the wallet contract is
 * what the host asks; a classic account signs the hashed preimage the way any
 * Stellar key does. The settlement pipeline has always accepted either — this
 * is just the app finally saying which it has.
 */
export type SettlementCustomer =
  | {kind: 'smart-wallet'; contractId: string; signer: HardwareDigestSigner}
  | {kind: 'classic'; address: string; signer: SettlementPipelineSigner};

export type TestnetSettlementInput = {
  payload: SignedPaymentIntentV1;
  config: StellarConfig;
  /** The account that pays, whichever kind this phone holds. */
  customer: SettlementCustomer;
  relayer: RelayerIdentity;
  /** Produces the merchant's signature over a digest naming this exact payer. */
  countersign: Countersigner;
  relayerSigner: {signTransaction(xdr: string): Promise<{signedTxXdr: string}>};
  latestLedger: number;
  /**
   * Set when the customer is paying out of a token the merchant did not ask
   * for. It never touches the envelope or the merchant's signature: the intent
   * below is the same one either way.
   */
  funding?: SettlementFunding;
  onProgress?: (progress: SettlementPipelineProgress) => void;
};

/**
 * Runs the relayed settlement: the customer signs only the authorization entry
 * for this exact invocation, and the relayer is the transaction source and fee
 * payer. The merchant's contract-digest signature covers the customer address,
 * so it can only be produced once the payer is known.
 */
export async function settleOnTestnet(input: TestnetSettlementInput) {
  assertRelayerIdentity(input.config, input.relayer);
  const {intent} = input.payload;
  const customerAddress =
    input.customer.kind === 'smart-wallet' ? input.customer.contractId : input.customer.address;

  const envelope = buildSettlementEnvelope(intent, {
    customer: customerAddress,
    networkPassphrase: input.config.networkPassphrase,
    settlementContractId: input.relayer.settlementContractId,
  });
  const digestClient = createSettlementClient(
    {...input.config, settlementContractId: input.relayer.settlementContractId},
    {publicKey: input.relayer.address},
  );
  const digest = (await digestClient.intent_digest({intent: envelope.intent}, {simulate: true})).result;
  // The digest names the payer, so the merchant can only sign it now. When this
  // device is the merchant that is a local call; otherwise it is a round trip to
  // the merchant's own phone, which is the only place its signing key lives.
  const merchantContractSignature = await input.countersign({
    intentId: intent.intentId,
    customerAddress,
    digest: Uint8Array.from(digest),
  });
  const authorization =
    input.customer.kind === 'smart-wallet'
      ? {
          customerAuthorizeEntry: createWalletAuthorizeEntry({
            key: {kind: 'device', signer: input.customer.signer},
            networkPassphrase: input.config.networkPassphrase,
            validUntilLedger: input.latestLedger + 120,
            reason: `Approve ${intent.amount} ${intent.asset.code} to ${intent.merchantName}`,
          }),
        }
      : {customerSigner: input.customer.signer};

  return settleSignedPayment({
    payload: input.payload,
    config: {...input.config, settlementContractId: input.relayer.settlementContractId},
    customerAddress,
    relayerAddress: input.relayer.address,
    latestLedger: input.latestLedger,
    merchantContractSignature,
    ...authorization,
    ...(input.funding ? {funding: input.funding} : {}),
    relayerSigner: input.relayerSigner,
    ...(input.onProgress ? {onProgress: input.onProgress} : {}),
  });
}
