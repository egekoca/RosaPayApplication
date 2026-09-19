import {LANGUAGES, languageMeta, missingTranslations, translate} from '../src/shared/i18n';
import {useAppStore} from '../src/state/appStore';

/** Every string the screens ask the translator for, in the order a demo hits them. */
const USED = [
  'ACCOUNT',
  'Activity',
  'Add lira',
  'Add money with Turkish lira',
  'Add money',
  // Recovery, and paying from an asset the merchant did not ask for. Both are
  // whole screens a Turkish customer would otherwise read in English.
  'RECOVER',
  'Recover your wallet',
  'I lost my phone',
  'Bring your wallet to this phone',
  'There is nothing to type',
  'This phone makes a new key',
  'The old key stops working',
  'WALLET FOUND',
  'Find my wallet',
  'Move it to this phone',
  'Something went wrong. Try again.',
  'That passkey does not belong to a Lumenade Pay wallet.',
  'You dismissed the prompt, so nothing was changed.',
  'PAYING WITH',
  'via Soroswap',
  'Checking what this wallet can pay with…',
  'Held directly in this wallet.',
  'Exchanged for the',
  'You will never pay more than',
  'Allow camera access',
  'Anchor transfer',
  'App language',
  'Asset',
  'Assets',
  'BUSINESS',
  'BUSINESS NAME',
  'Bank transfer · receive USDC in your wallet',
  'Business profile',
  'CONFIRMED',
  'Cash out',
  'Dashboard',
  'Check your phrase',
  'Confirmed at',
  'Continue',
  'Confirmed merchant payments',
  'Confirmed payments on this phone',
  'Copy address',
  'Copy wallet address',
  'Create a new wallet',
  'Create my wallet',
  'Create payment request',
  'Create the wallet',
  'Customers see this name. You are paid into the wallet you already have.',
  'Developer settings',
  'Done',
  'Email (optional)',
  'Enter the recovery phrase from your existing Stellar wallet. It never leaves this phone.',
  'Erases this account and its key from this phone.',
  'Expires',
  'Filter activity',
  'Finish wallet setup',
  'GET PAID',
  'Go back',
  'I already have a wallet',
  'I have written them down',
  'Intent ID',
  'Is this your account?',
  'Issuer',
  'LANGUAGE',
  'Ledger',
  'Long-press the recipient or issuer to copy it.',
  'Lumenade Pay needs a fresh start',
  'MONEY MOVEMENT',
  'Network',
  'New request',
  'No email',
  'No password to remember. Twelve words are your wallet, and they are what lets you add money in lira.',
  'No payments yet',
  'No, let me check again',
  'Not registered on Testnet',
  'One app for both sides of the counter. Your money moves on Stellar, and only this phone can approve it.',
  'Only used to send you a receipt. It is not a login.',
  'Or let the customer tap their phone here',
  'PAID IN',
  'PAYMENT COMPLETE',
  'PAYMENT STATUS',
  'PAYMENTS',
  'PAYMENT CHANNELS',
  'PRICED IN',
  'Paid into this wallet',
  'Payment request',
  'Payments',
  'Preview customer view',
  'Profile',
  'QR is the universal payment path on iOS and Android.',
  'QR RECEIVED',
  'RECEIVING ADDRESS',
  'REFERENCE',
  'REFERENCE (AÇIKLAMA)',
  'Reading the rate…',
  'Recipient',
  'Recovery phrase',
  'Restore your wallet',
  'SECURE CHECKOUT',
  'SEND TO',
  'STATUS',
  'STELLAR ACCOUNT',
  'Scan a code or hold phones together',
  "Scan this device's request",
  'Scan to pay',
  'Secret key',
  'Send and cash out',
  'Set up business',
  'Set up this device again',
  'Set up your business',
  'Set up your business profile before creating a payment request.',
  'Settle on Stellar.',
  'Share receipt',
  'Show balance in',
  'Show the words again',
  'Sign out',
  'Simulate the bank transfer',
  'Status',
  'Stellar account or contract address that receives payments',
  'TOTAL PAYMENTS',
  'TOTAL RECEIVED',
  'Tap the word that belongs in each place.',
  'The address is checked before it can ever appear on a payment request.',
  'The key that starts with an S, not the address that starts with a G',
  'The merchant signature failed verification. Ask for a new payment request.',
  'The settlement contract only accepts requests from a registered merchant key.',
  'Transaction',
  'Try again',
  'Twelve words are your wallet',
  'View on Explorer',
  'WALLET ADDRESS',
  'Wallet',
  'Write this in the transfer description. It is what routes the money to your wallet.',
  'YOU ARE PAYING',
  'YOU GET',
  'YOU SEND',
  'NFC RECEIVED',
  'OVERVIEW',
  'PAYMENT CHANNELS',
  'Money deposited',
  'Money withdrawn',
  'Channel totals reflect confirmed activity saved on this device.',
  'transfers',
  'confirmed',
  'Yes, use this wallet',
  "You can also hold this phone against the merchant's",
  'Your existing wallet',
  'Your name',
  'Your name is what a merchant sees on a receipt. Everything else stays on this phone.',
  'Your recovery phrase',
  'Your wallet and payment authorization were not changed.',
  'fee',
];

describe('the language setting', () => {
  it('starts in English, because that is what every string was written in', () => {
    expect(useAppStore.getState().language).toBe('en');
  });

  it('offers English and Turkish, each with a flag and its own name for itself', () => {
    expect(LANGUAGES.map(l => l.code)).toEqual(['en', 'tr']);
    for (const entry of LANGUAGES) {
      expect(entry.flag).not.toBe('');
      expect(entry.endonym).not.toBe('');
    }
    // A Turkish speaker looks for "Türkçe", not for "Turkish".
    expect(languageMeta('tr').endonym).toBe('Türkçe');
  });

  it('leaves a string alone when the language has no catalogue', () => {
    expect(translate('Scan to pay', 'en')).toBe('Scan to pay');
    expect(translate('Scan to pay', 'de')).toBe('Scan to pay');
  });

  it('translates into Turkish', () => {
    expect(translate('Scan to pay', 'tr')).toBe('Okut ve öde');
    expect(translate('Assets', 'tr')).toBe('Varlıklar');
  });

  /**
   * Keying on the English means an edit to a source string silently drops its
   * translation and the screen quietly reverts to English. This is the alarm:
   * every string the screens actually pass through the translator must have a
   * Turkish entry, or the list below names the ones that do not.
   */
  it('has a Turkish entry for every string the screens translate', () => {
    expect(missingTranslations('tr', USED)).toEqual([]);
  });
});
