import {Address, StrKey} from '@stellar/stellar-sdk';

export function isValidStellarAddress(value: string): boolean {
  try {
    Address.fromString(value);
    return StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value);
  } catch {
    return false;
  }
}
