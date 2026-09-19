import {
  authenticateContract,
  discoverAnchor,
  pollTransaction,
  startInteractive,
  type AnchorInfo,
  type AnchorTransaction,
  type InteractiveKind,
  type SessionToken,
} from '@rosapay/anchor';
import {Networks} from '@stellar/stellar-sdk';
import {createStellarConfig, createWalletAuthorizeEntry, testnetDeployment} from '@rosapay/stellar';

import {createHardwareDigestSigner} from '../payments/smartWalletSettlement';
import {fetchRelayerIdentity} from '../payments/testnetSettlement';
import type {PendingAnchorTransfer, SmartWallet} from '../../state/appStore';

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
 * Starts a hosted Testnet transfer directly for the device's C-account. SEP-45
 * is deliberate here: authenticating a throwaway classic account would make
 * the anchor deliver funds to the wrong account and introduce a trustline and
 * sweep that Lumenade Pay does not need.
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
  assertTestnetAnchorCompatibility(anchor, 'native');

  const relayer = await fetchRelayerIdentity(input.apiBaseUrl, fetcher);
  if (
    relayer.networkPassphrase !== config.networkPassphrase ||
    !/^G[A-Z2-7]{55}$/.test(relayer.address)
  ) {
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
        reason: `Connect Lumenade Pay to ${anchor.homeDomain}`,
      })(entry, undefined, validUntilLedger, networkPassphrase);
    },
  }, {
    rpcUrl: config.rpcUrl,
    fetcher,
  });

  const interactive = await startInteractive({
    anchor,
    session,
    kind: input.kind,
    assetCode: 'native',
    account: input.smartWallet.contractId,
    trustedInteractiveOrigins: TESTNET_ANCHOR_INTERACTIVE_ORIGINS,
    fetcher,
  });

  return {
    anchor,
    session,
    interactiveUrl: interactive.url,
    pending: {
      homeDomain: anchor.homeDomain,
      transactionId: interactive.transactionId,
      token: session.token,
      account: session.account,
      authProtocol: session.authProtocol,
      kind: input.kind,
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
  assertTestnetAnchorCompatibility(anchor, input.pending.assetCode);
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

export function assertTestnetAnchorCompatibility(anchor: AnchorInfo, assetCode: string): void {
  if (anchor.homeDomain !== TESTNET_ANCHOR_HOME_DOMAIN) {
    throw new AnchorTransferError('The discovered anchor is not the configured Testnet anchor');
  }
  if (anchor.networkPassphrase !== Networks.TESTNET) {
    throw new AnchorTransferError('The anchor is not serving Stellar Testnet');
  }
  if (!anchor.webAuthForContractsEndpoint || !anchor.webAuthContractId || !anchor.transferServerSep24) {
    throw new AnchorTransferError('The anchor does not publish complete SEP-45 and SEP-24 support');
  }
  if (
    !testnetDeployment.anchor.assets.includes(assetCode) ||
    !anchor.currencies.some(currency => currency.code === assetCode)
  ) {
    throw new AnchorTransferError(`The anchor does not publish ${assetCode} support`);
  }
}
