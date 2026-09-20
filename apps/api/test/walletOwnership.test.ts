import {describe, expect, it} from 'vitest';
import {assertWalletOwnership, CapabilityDeniedError} from '../src/application/AuthContext';

const smartWallet = 'CAV65DKNKPQZMY2MBXEDDBBCLMTVNIZUJVYFNDRUSKNCATIFKX66CSVO';
const classicAccount = 'GCOTXZES6GAOYXCNKSOOUNEBQU2QAFBPR2XGUZ66HVPA3AN5COR3ZQG5';

const principal = (walletContractId?: string) => ({
  userId: 'user-1',
  publicSigner: 'signer-1',
  capabilities: ['customer' as const],
  merchantProfileIds: [],
  ...(walletContractId ? {walletContractId} : {}),
});

describe('binding a device to the wallet it pays from', () => {
  it('holds a device to the wallet this API provisioned for it', () => {
    expect(() => assertWalletOwnership(principal(smartWallet), smartWallet)).not.toThrow();
    expect(() => assertWalletOwnership(principal(smartWallet), classicAccount)).toThrow(CapabilityDeniedError);
  });

  it('lets a customer who arrived with twelve words claim a request', () => {
    // `walletContractId` is only set for a smart wallet this API deployed, so a
    // classic account it has never seen compared as `undefined !== 'G…'` and
    // every such payer was refused — at the moment of claiming, which is the
    // first step of paying. Silence about an address is not evidence against it.
    expect(() => assertWalletOwnership(principal(), classicAccount)).not.toThrow();
  });

  it('asks nothing of a caller the API never authenticated', () => {
    expect(() => assertWalletOwnership(null, classicAccount)).not.toThrow();
  });
});
