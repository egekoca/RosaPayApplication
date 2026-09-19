import {
  generateRecoveryPhrase,
  isValidRecoveryPhrase,
  keypairFromRecoveryPhrase,
  keypairFromSecret,
  normalizeRecoveryPhrase,
  StellarKeyError,
} from '../src/features/wallet/stellarKey';

/**
 * SEP-0005's own published test vectors. These are the whole point of the
 * module: they are what proves the twelve words a customer typed open the same
 * account here that they open in Lobstr or Freighter. A derivation that is
 * merely self-consistent would pass every test but this one, and would quietly
 * hand every customer an empty address.
 */
const SEP5_VECTORS = [
  {
    // Test case 1
    phrase:
      'illness spike retreat truth genius clock brain pass fit cave bargain toe',
    address: 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6',
    secret: 'SBGWSG6BTNCKCOB3DIFBGCVMUPQFYPA2G4O34RMTB343OYPXU5DJDVMN',
  },
  {
    // Test case 2
    phrase:
      'resource asthma orphan phone ice canvas fire useful arch jewel impose vague theory cushion top',
    address: 'GAVXVW5MCK7Q66RIBWZZKZEDQTRXWCZUP4DIIFXCCENGW2P6W4OA34RH',
    secret: 'SAKS7I2PNDBE5SJSUSU2XLJ7K5XJ3V3K4UDFAHMSBQYPOKE247VHAGDB',
  },
  {
    // Test case 3
    phrase:
      'bench hurt jump file august wise shallow faculty impulse spring exact slush thunder author capable act festival slice deposit sauce coconut afford frown better',
    address: 'GC3MMSXBWHL6CPOAVERSJITX7BH76YU252WGLUOM5CJX3E7UCYZBTPJQ',
    secret: 'SAEWIVK3VLNEJ3WEJRZXQGDAS5NVG2BYSYDFRSH4GKVTS5RXNVED5AX7',
  },
  {
    // Test case 5
    phrase: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    address: 'GB3JDWCQJCWMJ3IILWIGDTQJJC5567PGVEVXSCVPEQOTDN64VJBDQBYX',
    secret: 'SBUV3MRWKNS6AYKZ6E6MOUVF2OYMON3MIUASWL3JLY5E3ISDJFELYBRZ',
  },
];

/*
 * SEP-0005 test case 4 is deliberately absent: it uses a BIP-39 passphrase, the
 * optional "25th word", which this app does not ask for. Someone whose wallet
 * has one would derive a valid-looking but empty account here — which is why the
 * import screen shows the derived address and makes them confirm it is theirs
 * before anything is saved.
 */

describe('deriving the account twelve words name', () => {
  it.each(SEP5_VECTORS)('matches the SEP-0005 vector for %#', ({phrase, address, secret}) => {
    const keypair = keypairFromRecoveryPhrase(phrase);
    expect(keypair.publicKey()).toBe(address);
    expect(keypair.secret()).toBe(secret);
  });

  it('reads a phrase back the way people actually paste it', () => {
    const {phrase, address} = SEP5_VECTORS[0]!;
    const messy = `  ILLNESS   Spike\nretreat  truth genius clock\tbrain pass fit cave bargain TOE `;
    expect(normalizeRecoveryPhrase(messy)).toBe(phrase);
    expect(keypairFromRecoveryPhrase(messy).publicKey()).toBe(address);
  });

  it('refuses a phrase whose checksum does not hold, rather than deriving a stranger', () => {
    // One word swapped for another real word: still twelve valid words, but the
    // BIP-39 checksum fails. Deriving anyway would produce a plausible, empty
    // address and look like the customer's money had vanished.
    const mistyped = 'illness spike retreat truth genius clock brain pass fit cave bargain toy';
    expect(isValidRecoveryPhrase(mistyped)).toBe(false);
    expect(() => keypairFromRecoveryPhrase(mistyped)).toThrow(StellarKeyError);
  });

  it('refuses words that are not in the wordlist at all', () => {
    expect(isValidRecoveryPhrase('not actually a recovery phrase at all no sir none')).toBe(false);
    expect(() => keypairFromRecoveryPhrase('')).toThrow(StellarKeyError);
  });
});

describe('a phrase this device generated', () => {
  it('is twelve words that derive an account', () => {
    const phrase = generateRecoveryPhrase();
    expect(phrase.split(' ')).toHaveLength(12);
    expect(isValidRecoveryPhrase(phrase)).toBe(true);
    expect(keypairFromRecoveryPhrase(phrase).publicKey()).toMatch(/^G[A-Z2-7]{55}$/);
  });

  it('is a different account every time', () => {
    const first = keypairFromRecoveryPhrase(generateRecoveryPhrase()).publicKey();
    const second = keypairFromRecoveryPhrase(generateRecoveryPhrase()).publicKey();
    expect(first).not.toBe(second);
  });
});

describe('importing a raw secret key', () => {
  it('accepts the secret that belongs to a known account', () => {
    const {secret, address} = SEP5_VECTORS[0]!;
    expect(keypairFromSecret(` ${secret} `).publicKey()).toBe(address);
  });

  it('refuses a public key pasted into the secret field', () => {
    expect(() => keypairFromSecret(SEP5_VECTORS[0]!.address)).toThrow(StellarKeyError);
  });
});
