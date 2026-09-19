import type {PaymentAsset} from '@rosapay/protocol';

export type PayableAsset = {
  /** What a person calls it. */
  code: string;
  /** What the intent carries, and what the contract is asked to move. */
  asset: PaymentAsset;
  /** How SEP-38 names it, for asking an anchor what it is worth. */
  sep38: string;
  /** One line for a merchant choosing between them. */
  note: string;
};

/**
 * What a merchant may ask to be paid in.
 *
 * This list has to match what the settlement contract will accept: it refuses
 * any token it was not told about, so offering one here that is not registered
 * on chain would fail at the counter with the customer already committed.
 * `npm run testnet:register-asset -- --list` reads the contract itself and is
 * the answer to "is this still true?".
 *
 * Registered on Testnet:
 *   XLM   CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC (constructor)
 *   USDC  CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA (tx 5deaab81…)
 */
export const payableAssets: PayableAsset[] = [
  {
    code: 'XLM',
    asset: {type: 'native', code: 'XLM', decimals: 7},
    sep38: 'stellar:native',
    note: 'Settles fastest, and every account holds it',
  },
  {
    code: 'USDC',
    // The issuer our own price anchor lists, so the currency a merchant prices
    // in and the asset the customer sends come from the same place.
    asset: {
      type: 'credit',
      code: 'USDC',
      issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      decimals: 7,
    },
    sep38: 'stellar:USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    note: 'Holds its value between the sale and the payout',
  },
];

export const defaultPayableAsset = payableAssets[0]!;

export function payableAssetByCode(code: string): PayableAsset | undefined {
  return payableAssets.find(entry => entry.code === code);
}
