import {
  authenticate,
  authenticateContract,
  discoverAnchor,
  pollTransaction,
  startInteractive,
  type AnchorInfo,
  type AnchorTransaction,
  type InteractiveKind,
  type SessionToken,
} from '@rosapay/anchor';
import {Networks, Transaction} from '@stellar/stellar-sdk';
import {createStellarConfig, createWalletAuthorizeEntry, testnetDeployment} from '@rosapay/stellar';

import {loadSigningKey} from './keyVault';
import {keypairFromSecret} from './stellarKey';
import {createHardwareDigestSigner} from '../payments/smartWalletSettlement';
import {assertRelayerIdentity, fetchRelayerIdentity} from '../payments/testnetSettlement';
import type {PendingAnchorTransfer, SmartWallet, StellarAccount} from '../../state/appStore';

export const TESTNET_ANCHOR_HOME_DOMAIN = testnetDeployment.anchor.homeDomain;
export const TESTNET_ANCHOR_INTERACTIVE_ORIGINS = testnetDeployment.anchor.interactiveOrigins;

export class AnchorTransferError extends Error {
  override readonly name = 'AnchorTransferError';
}

export type StartedAnchorTransfer = {
  anchor: AnchorInfo;
  session: SessionToken;
  interactiveUrl: string;
  pending: PendingAnchorTransfer;
};

/**
 * Starts a hosted Testnet transfer directly for the production C-account.
 */
export async function startWalletAnchorTransfer(input: {
  kind: InteractiveKind;
  smartWallet: SmartWallet;
  apiBaseUrl: string;
  fetcher?: typeof fetch;
}): Promise<StartedAnchorTransfer> {
  const fetcher = input.fetcher ?? fetch;
  const config = createStellarConfig('testnet');
  const anchor = await discoverAnchor(TESTNET_ANCHOR_HOME_DOMAIN, {fetcher});
  assertTestnetAnchorCompatibility(anchor, 'native', 'SEP-45');

  const relayer = await fetchRelayerIdentity(input.apiBaseUrl, fetcher);
  try {
    assertRelayerIdentity(config, relayer);
  } catch {
    throw new AnchorTransferError('The relayer is not a usable Stellar Testnet simulation source');
  }

  const hardwareSigner = createHardwareDigestSigner(input.smartWallet.devicePublicKey);
  const session = await authenticateContract(anchor, {
    accountId: input.smartWallet.contractId,
    transactionSourceAccount: relayer.address,
    authorizeEntry: (entry, validUntilLedger, networkPassphrase) => {
      if (networkPassphrase !== config.networkPassphrase) {
        throw new AnchorTransferError('The anchor asked the wallet to sign for another network');
      }
      return createWalletAuthorizeEntry({
        signer: hardwareSigner,
        networkPassphrase,
        validUntilLedger,
        reason: `Connect Rosa Pay to ${anchor.homeDomain}`,
      })(entry, undefined, validUntilLedger, networkPassphrase);
    },
  }, {rpcUrl: config.rpcUrl, fetcher});

  const interactive = await startInteractive({
    anchor,
    session,
    kind: input.kind,
    assetCode: 'native',
    account: input.smartWallet.contractId,
    trustedInteractiveOrigins: TESTNET_ANCHOR_INTERACTIVE_ORIGINS,
    fetcher,
  });

  return toStartedTransfer(anchor, session, interactive.url, interactive.transactionId, input.kind);
}

/** Experimental classic-account adapter, intentionally outside production navigation. */
export async function startClassicWalletAnchorTransfer(input: {
  kind: InteractiveKind;
  wallet: StellarAccount;
  fetcher?: typeof fetch;
}): Promise<StartedAnchorTransfer> {
  const fetcher = input.fetcher ?? fetch;
  const config = createStellarConfig('testnet');
  const anchor = await discoverAnchor(TESTNET_ANCHOR_HOME_DOMAIN, {fetcher});
  assertTestnetAnchorCompatibility(anchor, 'native', 'SEP-10');

  // The key comes out once, behind the device prompt, and only to sign the
  // anchor's challenge. It is not held past this call.
  const keypair = keypairFromSecret(
    await loadSigningKey(`Connect Rosa Pay to ${anchor.homeDomain}`),
  );
  if (keypair.publicKey() !== input.wallet.address) {
    throw new AnchorTransferError('The key on this phone does not match the wallet it shows');
  }

  const session = await authenticate(
    anchor,
    {
      accountId: input.wallet.address,
      signTransaction: async (xdr, options) => {
        if (options.networkPassphrase !== config.networkPassphrase) {
          throw new AnchorTransferError('The anchor asked the wallet to sign for another network');
        }
        const challenge = new Transaction(xdr, options.networkPassphrase);
        challenge.sign(keypair);
        return challenge.toXDR();
      },
    },
    {fetcher},
  );

  const interactive = await startInteractive({
    anchor,
    session,
    kind: input.kind,
    assetCode: 'native',
    account: input.wallet.address,
    trustedInteractiveOrigins: TESTNET_ANCHOR_INTERACTIVE_ORIGINS,
    fetcher,
  });

  return toStartedTransfer(anchor, session, interactive.url, interactive.transactionId, input.kind);
}

function toStartedTransfer(
  anchor: AnchorInfo,
  session: SessionToken,
  interactiveUrl: string,
  transactionId: string,
  kind: InteractiveKind,
): StartedAnchorTransfer {
  return {
    anchor,
    session,
    interactiveUrl,
    pending: {
      homeDomain: anchor.homeDomain,
      transactionId,
      token: session.token,
      account: session.account,
      authProtocol: session.authProtocol,
      kind,
      assetCode: 'native',
      startedAt: new Date().toISOString(),
    },
  };
}

/** Rediscovers the anchor before resuming so stale endpoints are not trusted. */
export async function resumeWalletAnchorTransfer(input: {
  pending: PendingAnchorTransfer;
  onUpdate?: (transaction: AnchorTransaction) => void;
  fetcher?: typeof fetch;
  attempts?: number;
}): Promise<AnchorTransaction> {
  const fetcher = input.fetcher ?? fetch;
  if (input.pending.homeDomain !== TESTNET_ANCHOR_HOME_DOMAIN) {
    throw new AnchorTransferError('The saved transfer belongs to an unconfigured anchor');
  }
  const anchor = await discoverAnchor(input.pending.homeDomain, {fetcher});
  assertTestnetAnchorCompatibility(anchor, input.pending.assetCode, input.pending.authProtocol);
  return pollTransaction({
    anchor,
    session: {
      token: input.pending.token,
      account: input.pending.account,
      homeDomain: input.pending.homeDomain,
      authProtocol: input.pending.authProtocol,
    },
    transactionId: input.pending.transactionId,
    attempts: input.attempts ?? 30,
    intervalMs: 2_000,
    ...(input.onUpdate ? {onUpdate: input.onUpdate} : {}),
    fetcher,
  });
}

export function assertTestnetAnchorCompatibility(
  anchor: AnchorInfo,
  assetCode: string,
  authProtocol: 'SEP-10' | 'SEP-45' = 'SEP-45',
): void {
  if (anchor.homeDomain !== TESTNET_ANCHOR_HOME_DOMAIN) {
    throw new AnchorTransferError('The discovered anchor is not the configured Testnet anchor');
  }
  if (anchor.networkPassphrase !== Networks.TESTNET) {
    throw new AnchorTransferError('The anchor is not serving Stellar Testnet');
  }
  const hasAuthentication = authProtocol === 'SEP-45'
    ? Boolean(anchor.webAuthForContractsEndpoint && anchor.webAuthContractId)
    : Boolean(anchor.webAuthEndpoint);
  if (!hasAuthentication || !anchor.transferServerSep24) {
    throw new AnchorTransferError(`The anchor does not publish complete ${authProtocol} and SEP-24 support`);
  }
  if (
    !testnetDeployment.anchor.assets.includes(assetCode) ||
    !anchor.currencies.some(currency => currency.code === assetCode)
  ) {
    throw new AnchorTransferError(`The anchor does not publish ${assetCode} support`);
  }
}
