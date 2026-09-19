import {useMemo} from 'react';
import {useAppStore} from '../../state/appStore';

/**
 * The account this phone pays from, whichever kind it is.
 *
 * Onboarding offers two custody models and they are not interchangeable at the
 * ledger: a smart wallet is a contract account, a recovery-phrase wallet is a
 * classic one. Screens mostly need the address and only sometimes need to know
 * which, so both come from one place rather than each screen reaching for
 * `smartWallet` and quietly showing nothing to everyone who chose the other.
 *
 * The smart wallet wins when a phone somehow holds both, matching the choice
 * the settlement path makes — the screens and the money must not disagree
 * about which account is in use.
 */
export type CurrentAccount = {
  address: string;
  kind: 'smart-wallet' | 'classic';
};

export function selectCurrentAccount(
  state: Pick<ReturnType<typeof useAppStore.getState>, 'smartWallet' | 'wallet'>,
): CurrentAccount | null {
  if (state.smartWallet) return {address: state.smartWallet.contractId, kind: 'smart-wallet'};
  if (state.wallet) return {address: state.wallet.address, kind: 'classic'};
  return null;
}

export function currentAccount(): CurrentAccount | null {
  return selectCurrentAccount(useAppStore.getState());
}

/**
 * Derived per render rather than selected, because the selector builds an
 * object: zustand compares snapshots by identity, so returning a fresh one
 * every time makes React think the store changed on every render.
 */
export function useCurrentAccount(): CurrentAccount | null {
  const smartWallet = useAppStore(state => state.smartWallet);
  const wallet = useAppStore(state => state.wallet);
  return useMemo(() => selectCurrentAccount({smartWallet, wallet}), [smartWallet, wallet]);
}

/**
 * Whether an asset other than lumens needs a trustline before it can arrive.
 *
 * A contract account holds any asset the moment it is paid, because a Stellar
 * Asset Contract keeps the balance in its own storage. A classic account does
 * not: without a trustline the asset cannot reach it at all, and reading that
 * balance fails rather than answering zero. The difference decides whether a
 * failed balance read means "none of this" or "the ledger is unreachable".
 */
export function needsTrustlines(account: CurrentAccount | null): boolean {
  return account?.kind === 'classic';
}
