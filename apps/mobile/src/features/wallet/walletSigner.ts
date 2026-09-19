import {Buffer} from 'buffer';
import {hash, Keypair} from '@stellar/stellar-sdk';
import type {SettlementPipelineSigner} from '@rosapay/stellar';
import {useAppStore} from '../../state/appStore';
import {KeyVaultError, loadSigningKey} from './keyVault';
import {keypairFromSecret} from './stellarKey';

export class WalletSignerError extends Error {
  override readonly name = 'WalletSignerError';

  constructor(
    readonly code: 'NO_WALLET',
    message: string,
  ) {
    super(message);
  }
}

export type CustomerSigner = SettlementPipelineSigner & {address: string};

/**
 * The customer's signer for one payment.
 *
 * The key is fetched once, behind a single device prompt, and lives only in this
 * closure until the settlement finishes. Fetching it inside `signAuthEntry`
 * instead would prompt again for every authorization entry the simulation asks
 * for, and a customer asked twice learns to approve without reading.
 *
 * `reason` is what the phone shows on that prompt, so it names the amount and
 * the merchant rather than saying "authenticate".
 */
export async function createCustomerSigner(reason: string): Promise<CustomerSigner> {
  const wallet = useAppStore.getState().wallet;
  if (!wallet) {
    throw new WalletSignerError('NO_WALLET', 'There is no wallet on this phone yet.');
  }

  const keypair = keypairFromSecret(await loadSigningKey(reason));
  if (keypair.publicKey() !== wallet.address) {
    // The stored address and the stored key disagree, so one of them is from a
    // wallet that was replaced. Signing anyway would move money out of an
    // account the screens never showed.
    throw new KeyVaultError(
      'MISSING',
      'The key on this phone does not match the wallet it shows. Restore your wallet with your recovery phrase.',
    );
  }

  return {
    address: wallet.address,
    // What the SDK asks of a classic account: sign the hash of the raw
    // authorization preimage. Anything else simulates fine and is rejected by
    // the ledger.
    signAuthEntry: async authEntry => ({
      signedAuthEntry: keypair.sign(hash(Buffer.from(authEntry, 'base64'))).toString('base64'),
      signerAddress: wallet.address,
    }),
  };
}

/** The account this phone pays from, for screens that only need the address. */
export function walletAddress(): string | undefined {
  return useAppStore.getState().wallet?.address;
}

/** Turns a derived keypair into the pair the store and the vault each keep. */
export function accountRecordFor(keypair: Keypair, origin: 'created' | 'imported') {
  return {
    account: {address: keypair.publicKey(), origin},
    secret: keypair.secret(),
  };
}
