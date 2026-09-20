import {createWalletAuthorizeEntry, StellarRpcClient, createStellarConfig} from '@rosapay/stellar';
import {
  createHardwareDigestSigner,
  ensureSmartWallet,
} from '../payments/smartWalletSettlement';
import {
  assertRelayerIdentity,
  createRemoteRelayerSigner,
  fetchRelayerIdentity,
} from '../payments/testnetSettlement';
import {fundBridgeFromSmartWallet, type AnchorBridge} from './anchorBridge';
import {useAppStore} from '../../state/appStore';
import {parseStroops} from '@rosapay/stellar';

/**
 * Moves USDC out of the smart wallet and onto the bridge, on the way to the
 * anchor.
 *
 * Only the wallet's own signer can authorize this, so it goes through the same
 * device prompt and the same relayer as a payment does. It is a separate module
 * from the ramp because the ramp should not know how this wallet authorizes
 * anything - it only knows that something has to put the money where the anchor
 * can be paid from.
 */
export async function moveUsdcToBridge(input: {
  bridge: AnchorBridge;
  smartWalletContractId: string;
  assetIssuer: string;
  amountUsdc: string;
}): Promise<void> {
  const config = createStellarConfig('testnet');
  const baseUrl = useAppStore.getState().apiBaseUrl;
  const relayer = await fetchRelayerIdentity(baseUrl);
  assertRelayerIdentity(config, relayer);
  const relayerSigner = createRemoteRelayerSigner(baseUrl);
  const wallet = await ensureSmartWallet();
  const latestLedger = (await new StellarRpcClient(config).health()).latestLedger;

  await fundBridgeFromSmartWallet({
    bridge: input.bridge,
    smartWalletContractId: input.smartWalletContractId,
    assetCode: 'USDC',
    assetIssuer: input.assetIssuer,
    amount: parseStroops(input.amountUsdc),
    relayerAddress: relayer.address,
    relayerSign: xdr => relayerSigner.signTransaction(xdr),
    authorizeEntry: createWalletAuthorizeEntry({
      key: {kind: 'device', signer: createHardwareDigestSigner(wallet.devicePublicKey)},
      networkPassphrase: config.networkPassphrase,
      validUntilLedger: latestLedger + 120,
      reason: `Cash out ${input.amountUsdc} USDC to lira`,
    }),
    config,
  });
}

/**
 * Gives the bridge the lumens it needs to exist and pay its own fees, out of
 * the wallet's balance.
 *
 * Native XLM is a Stellar Asset Contract like any other here, so this is the
 * same transfer as moving USDC — the wallet authorizes, the relayer pays the
 * fee. It happens once, folded into the first ramp a customer runs.
 */
export async function fundBridgeWithLumens(input: {
  bridge: AnchorBridge;
  smartWalletContractId: string;
  amountStroops: bigint;
}): Promise<void> {
  const config = createStellarConfig('testnet');
  const baseUrl = useAppStore.getState().apiBaseUrl;
  const relayer = await fetchRelayerIdentity(baseUrl);
  assertRelayerIdentity(config, relayer);
  const relayerSigner = createRemoteRelayerSigner(baseUrl);
  const wallet = await ensureSmartWallet();
  const latestLedger = (await new StellarRpcClient(config).health()).latestLedger;

  await fundBridgeFromSmartWallet({
    bridge: input.bridge,
    smartWalletContractId: input.smartWalletContractId,
    // Native lumens: no issuer, and the contract is derived from the network.
    assetCode: 'native',
    assetIssuer: '',
    amount: input.amountStroops,
    relayerAddress: relayer.address,
    relayerSign: xdr => relayerSigner.signTransaction(xdr),
    authorizeEntry: createWalletAuthorizeEntry({
      key: {kind: 'device', signer: createHardwareDigestSigner(wallet.devicePublicKey)},
      networkPassphrase: config.networkPassphrase,
      validUntilLedger: latestLedger + 120,
      reason: 'Set up the lira ramp on this phone',
    }),
    config,
  });
}
