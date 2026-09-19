import {Keypair, Networks, WebAuth} from '@stellar/stellar-sdk';
import {describe, expect, it, vi} from 'vitest';

import {
  AnchorDiscoveryError,
  InteractiveError,
  WebAuthError,
  authenticate,
  discoverAnchor,
  isFinal,
  isTrustedAnchorUrl,
  needsCustomerAction,
  parseStellarToml,
  pollTransaction,
  assetCodeOf,
  readIndicativePrices,
  readCurrencyPrices,
  currencyValueOfAsset,
  assetAmountForPrice,
  PriceConversionError,
  readTransaction,
  createMockSep12Anchor,
  getCustomerInfo,
  submitCustomerInfo,
  startInteractive,
  transactionPhase,
  type AnchorInfo,
} from '../src';

const anchorKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const customer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
const impostor = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
const homeDomain = 'testanchor.example.org';

const toml = `
ACCOUNTS = ["${anchorKey.publicKey()}"]
SIGNING_KEY = "${anchorKey.publicKey()}"
NETWORK_PASSPHRASE = "${Networks.TESTNET}"
WEB_AUTH_ENDPOINT = "https://${homeDomain}/auth"
TRANSFER_SERVER_SEP0024 = "https://${homeDomain}/sep24"

[[CURRENCIES]]
code = "USDC"
issuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
status = "test"

[[CURRENCIES]]
code = "native"
status = "test"

[DOCUMENTATION]
ORG_NAME = "Example"
`;

function anchorInfo(): AnchorInfo {
  return {
    homeDomain,
    networkPassphrase: Networks.TESTNET,
    signingKey: anchorKey.publicKey(),
    webAuthEndpoint: `https://${homeDomain}/auth`,
    transferServerSep24: `https://${homeDomain}/sep24`,
    currencies: [{code: 'USDC'}],
  };
}

function challengeFrom(signer: Keypair, options: {account?: string; domain?: string} = {}): string {
  return WebAuth.buildChallengeTx(
    signer,
    options.account ?? customer.publicKey(),
    options.domain ?? homeDomain,
    300,
    Networks.TESTNET,
    homeDomain,
  );
}

function signer() {
  return {
    accountId: customer.publicKey(),
    signTransaction: vi.fn(async (xdr: string) => {
      const {tx} = WebAuth.readChallengeTx(xdr, anchorKey.publicKey(), Networks.TESTNET, homeDomain, homeDomain);
      tx.sign(customer);
      return tx.toXDR();
    }),
  };
}

function fetcherFor(handlers: Record<string, () => Response>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const handler = Object.entries(handlers).find(([prefix]) => url.startsWith(prefix));
    if (!handler) throw new Error(`No handler for ${url}`);
    return handler[1]();
  }) as unknown as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

describe('discovering an anchor', () => {
  it('reads the endpoints and assets it publishes', () => {
    const {values, currencies} = parseStellarToml(toml);
    expect(values.SIGNING_KEY).toBe(anchorKey.publicKey());
    expect(values.WEB_AUTH_ENDPOINT).toBe(`https://${homeDomain}/auth`);
    expect(currencies.map(currency => currency.code)).toEqual(['USDC', 'native']);
    // A later table must not be read as another currency.
    expect(currencies.some(currency => currency.ORG_NAME)).toBe(false);
  });

  it('ignores comments rather than treating them as values', () => {
    const {values} = parseStellarToml('SIGNING_KEY = "GABC" # the key\n# NETWORK_PASSPHRASE = "wrong"');
    expect(values.SIGNING_KEY).toBe('GABC');
    expect(values.NETWORK_PASSPHRASE).toBeUndefined();
  });

  it('refuses an anchor that publishes no signing key', async () => {
    const fetcher = fetcherFor({'https://': () => new Response('NETWORK_PASSPHRASE = "x"')});
    // Without it, no challenge could ever be shown to be genuine.
    await expect(discoverAnchor(homeDomain, {fetcher})).rejects.toThrow(AnchorDiscoveryError);
  });

  it('refuses an anchor that does not say which network it serves', async () => {
    const fetcher = fetcherFor({'https://': () => new Response(`SIGNING_KEY = "${anchorKey.publicKey()}"`)});
    await expect(discoverAnchor(homeDomain, {fetcher})).rejects.toThrow(/which network/);
  });

  it('reports a domain that publishes nothing', async () => {
    const fetcher = fetcherFor({'https://': () => new Response('missing', {status: 404})});
    await expect(discoverAnchor(homeDomain, {fetcher})).rejects.toThrow(/did not publish/);
  });

  it('refuses insecure endpoints published by an anchor', async () => {
    const source = `SIGNING_KEY = "${anchorKey.publicKey()}"\nNETWORK_PASSPHRASE = "${Networks.TESTNET}"\nTRANSFER_SERVER_SEP0024 = "http://${homeDomain}/sep24"`;
    const fetcher = fetcherFor({'https://': () => new Response(source)});
    await expect(discoverAnchor(homeDomain, {fetcher})).rejects.toThrow(/HTTPS TRANSFER_SERVER_SEP0024/);
  });
});

describe('authenticating with an anchor', () => {
  it('signs a genuine challenge and keeps the session token', async () => {
    const client = signer();
    const fetcher = fetcherFor({
      [`https://${homeDomain}/auth`]: () => json({transaction: challengeFrom(anchorKey), network_passphrase: Networks.TESTNET}),
    });

    // The POST and the GET share a prefix, so answer both from one handler.
    let call = 0;
    const both = vi.fn(async () => (call++ === 0
      ? json({transaction: challengeFrom(anchorKey), network_passphrase: Networks.TESTNET})
      : json({token: 'jwt-token'}))) as unknown as typeof fetch;

    const session = await authenticate(anchorInfo(), client, {fetcher: both});
    expect(session).toEqual({
      token: 'jwt-token',
      account: customer.publicKey(),
      homeDomain,
      authProtocol: 'SEP-10',
    });
    expect(client.signTransaction).toHaveBeenCalledTimes(1);
    void fetcher;
  });

  it('refuses a challenge signed by anyone but the anchor', async () => {
    const client = signer();
    const fetcher = vi.fn(async () =>
      json({transaction: challengeFrom(impostor), network_passphrase: Networks.TESTNET}),
    ) as unknown as typeof fetch;

    // Someone intercepting the request must not get the customer's signature.
    await expect(authenticate(anchorInfo(), client, {fetcher})).rejects.toThrow(WebAuthError);
    expect(client.signTransaction).not.toHaveBeenCalled();
  });

  it('refuses a challenge naming a different account', async () => {
    const client = signer();
    const fetcher = vi.fn(async () =>
      json({
        transaction: challengeFrom(anchorKey, {account: impostor.publicKey()}),
        network_passphrase: Networks.TESTNET,
      }),
    ) as unknown as typeof fetch;

    await expect(authenticate(anchorInfo(), client, {fetcher})).rejects.toThrow(WebAuthError);
    expect(client.signTransaction).not.toHaveBeenCalled();
  });

  it('refuses a challenge for another network', async () => {
    const client = signer();
    const fetcher = vi.fn(async () =>
      json({transaction: challengeFrom(anchorKey), network_passphrase: Networks.PUBLIC}),
    ) as unknown as typeof fetch;

    await expect(authenticate(anchorInfo(), client, {fetcher})).rejects.toThrow(/different Stellar network/);
    expect(client.signTransaction).not.toHaveBeenCalled();
  });

  it('says so when an anchor offers no authentication at all', async () => {
    const withoutAuth = {...anchorInfo(), webAuthEndpoint: undefined};
    await expect(authenticate(withoutAuth, signer())).rejects.toThrow(/does not offer SEP-10/);
  });
});

describe('opening the anchor’s own pages', () => {
  const session = {
    token: 'jwt',
    account: customer.publicKey(),
    homeDomain,
    authProtocol: 'SEP-10' as const,
  };

  it('returns the URL and the transaction to follow', async () => {
    const fetcher = vi.fn(async () =>
      json({type: 'interactive_customer_info_needed', url: `https://${homeDomain}/sep24/deposit?id=1`, id: 'tx-1'}),
    ) as unknown as typeof fetch;

    const interactive = await startInteractive({
      anchor: anchorInfo(),
      session,
      kind: 'deposit',
      assetCode: 'USDC',
      fetcher,
    });

    expect(interactive).toEqual({url: `https://${homeDomain}/sep24/deposit?id=1`, transactionId: 'tx-1'});
  });

  it('refuses to open a page on someone else’s domain', async () => {
    const fetcher = vi.fn(async () =>
      json({url: 'https://phishing.example.com/sep24/deposit', id: 'tx-1'}),
    ) as unknown as typeof fetch;

    // The customer is mid-payment and would believe the page they are shown.
    await expect(
      startInteractive({anchor: anchorInfo(), session, kind: 'deposit', assetCode: 'USDC', fetcher}),
    ).rejects.toThrow(InteractiveError);
  });

  it('accepts the anchor’s own subdomains and nothing else', () => {
    const anchor = anchorInfo();
    expect(isTrustedAnchorUrl(`https://${homeDomain}/x`, anchor)).toBe(true);
    expect(isTrustedAnchorUrl(`https://pay.${homeDomain}/x`, anchor)).toBe(true);
    expect(isTrustedAnchorUrl(`http://${homeDomain}/x`, anchor)).toBe(false);
    expect(isTrustedAnchorUrl(`https://${homeDomain}.evil.com/x`, anchor)).toBe(false);
    expect(isTrustedAnchorUrl('https://evil.com/x', anchor)).toBe(false);
    expect(isTrustedAnchorUrl('not a url', anchor)).toBe(false);
  });

  it('accepts a separately hosted UI only through an exact configured HTTPS origin', () => {
    const anchor = anchorInfo();
    const approved = ['https://approved-ui.example.net'];
    expect(isTrustedAnchorUrl('https://approved-ui.example.net/deposit?id=1', anchor, approved)).toBe(true);
    expect(isTrustedAnchorUrl('https://child.approved-ui.example.net/deposit', anchor, approved)).toBe(false);
    expect(isTrustedAnchorUrl('http://approved-ui.example.net/deposit', anchor, approved)).toBe(false);
    expect(isTrustedAnchorUrl('https://approved-ui.example.net.evil.org/deposit', anchor, approved)).toBe(false);
  });

  it('reads where a transfer has got to', async () => {
    const fetcher = vi.fn(async () =>
      json({transaction: {id: 'tx-1', kind: 'deposit', status: 'pending_anchor', amount_in: '10.00'}}),
    ) as unknown as typeof fetch;

    const transaction = await readTransaction({
      anchor: anchorInfo(),
      session,
      transactionId: 'tx-1',
      fetcher,
    });

    expect(transaction).toMatchObject({id: 'tx-1', status: 'pending_anchor', amount_in: '10.00'});
  });

  it('knows which states are waiting on the customer and which are over', () => {
    expect(needsCustomerAction('incomplete')).toBe(true);
    expect(needsCustomerAction('pending_user_transfer_complete')).toBe(true);
    expect(needsCustomerAction('pending_trust')).toBe(true);
    expect(needsCustomerAction('pending_anchor')).toBe(false);
    expect(isFinal('completed')).toBe(true);
    expect(isFinal('refunded')).toBe(true);
    expect(isFinal('pending_stellar')).toBe(false);
    expect(transactionPhase('pending_user')).toBe('action_required');
    expect(transactionPhase('on_hold')).toBe('pending');
    expect(transactionPhase('completed')).toBe('completed');
    expect(transactionPhase('expired')).toBe('failed');
  });

  it('follows status changes without turning a bounded timeout into a failure', async () => {
    const statuses = ['pending_anchor', 'pending_stellar', 'completed'] as const;
    const updates: string[] = [];
    let call = 0;
    const fetcher = vi.fn(async () =>
      json({transaction: {id: 'tx-1', kind: 'deposit', status: statuses[call++]}}),
    ) as unknown as typeof fetch;

    const transaction = await pollTransaction({
      anchor: anchorInfo(),
      session,
      transactionId: 'tx-1',
      attempts: 5,
      intervalMs: 0,
      sleep: async () => undefined,
      onUpdate: update => updates.push(update.status),
      fetcher,
    });

    expect(transaction.status).toBe('completed');
    expect(updates).toEqual(['pending_anchor', 'pending_stellar', 'completed']);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('returns the latest pending state when the polling window ends', async () => {
    const fetcher = vi.fn(async () =>
      json({transaction: {id: 'tx-1', kind: 'deposit', status: 'on_hold'}}),
    ) as unknown as typeof fetch;

    const transaction = await pollTransaction({
      anchor: anchorInfo(),
      session,
      transactionId: 'tx-1',
      attempts: 2,
      intervalMs: 0,
      sleep: async () => undefined,
      fetcher,
    });

    expect(transaction.status).toBe('on_hold');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('returns immediately when the customer has another action', async () => {
    const fetcher = vi.fn(async () =>
      json({transaction: {id: 'tx-1', kind: 'deposit', status: 'incomplete'}}),
    ) as unknown as typeof fetch;

    const transaction = await pollTransaction({
      anchor: anchorInfo(),
      session,
      transactionId: 'tx-1',
      attempts: 30,
      intervalMs: 0,
      fetcher,
    });

    expect(transaction.status).toBe('incomplete');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('refuses an unknown transaction status instead of presenting it incorrectly', async () => {
    const fetcher = vi.fn(async () =>
      json({transaction: {id: 'tx-1', kind: 'deposit', status: 'looks_done'}}),
    ) as unknown as typeof fetch;

    await expect(
      readTransaction({anchor: anchorInfo(), session, transactionId: 'tx-1', fetcher}),
    ).rejects.toThrow(/cannot read/);
  });
});

describe('SEP-12 customer information demo', () => {
  const session = {
    token: 'mock-sep10-token',
    account: customer.publicKey(),
    homeDomain,
    authProtocol: 'SEP-10' as const,
  };

  it('runs the mock anchor from NEEDS_INFO to ACCEPTED without retaining values', async () => {
    const mock = createMockSep12Anchor();
    const anchor = {...anchorInfo(), kycServer: mock.baseUrl};

    const initial = await getCustomerInfo({anchor, session, fetcher: mock.fetcher});
    expect(initial.status).toBe('NEEDS_INFO');
    expect(initial.fields).toHaveProperty('first_name');

    const accepted = await submitCustomerInfo({
      anchor,
      session,
      customerId: initial.id,
      fields: {first_name: 'Demo', last_name: 'Customer', email: 'demo@example.test', country: 'TR'},
      fetcher: mock.fetcher,
    });
    expect(accepted).toMatchObject({id: initial.id, status: 'ACCEPTED', fields: {}});

    const reread = await getCustomerInfo({anchor, session, customerId: initial.id, fetcher: mock.fetcher});
    expect(reread.status).toBe('ACCEPTED');
    expect(JSON.stringify(reread)).not.toContain('Demo');
  });

  it('keeps the mock SEP-12 endpoint authenticated', async () => {
    const mock = createMockSep12Anchor();
    const response = await mock.fetcher(`${mock.baseUrl}/customer?account=${customer.publicKey()}`);
    expect(response.status).toBe(401);
  });
});

describe('what a balance is worth', () => {
  const withQuotes: AnchorInfo = {...anchorInfo(), quoteServer: `https://${homeDomain}/sep38`};

  it('reads the anchor’s indicative prices', async () => {
    const fetcher = vi.fn(async () =>
      json({buy_assets: [{asset: 'iso4217:USD', price: '0.39', decimals: 4}]}),
    ) as unknown as typeof fetch;

    const prices = await readIndicativePrices({source: withQuotes, sellAmount: '100', fetcher});

    expect(prices).toEqual([{asset: 'iso4217:USD', price: '0.39', decimals: 4}]);
  });

  it('returns nothing when the anchor quotes no prices', async () => {
    const fetcher = vi.fn(async () => json({}, 404)) as unknown as typeof fetch;
    await expect(readIndicativePrices({source: withQuotes, sellAmount: '100', fetcher})).resolves.toEqual([]);
  });

  it('reads a bare quote server that is not an anchor at all', async () => {
    // The deployment serves its own SEP-38 for currencies no anchor prices, so
    // a `quoteServer` on its own has to be as good as a discovered anchor.
    const fetcher = vi.fn(async () =>
      json({buy_assets: [{asset: 'iso4217:TRY', price: '8.97', decimals: 2}]}),
    ) as unknown as typeof fetch;

    const prices = await readIndicativePrices({
      source: {quoteServer: 'https://pay.example/sep38'},
      sellAmount: '1',
      fetcher,
    });

    expect(prices).toEqual([{asset: 'iso4217:TRY', price: '8.97', decimals: 2}]);
    const [url] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('https://pay.example/sep38/prices');
  });

  it('returns nothing when there is no quote server at all', async () => {
    // Rather than invent a rate, which is what a payment screen must never do.
    await expect(readIndicativePrices({source: anchorInfo(), sellAmount: '100'})).resolves.toEqual([]);
  });

  /**
   * SEP-38 quotes units of the sold asset for one unit of the bought one, which
   * is the opposite of how a menu price reads. The numbers here are what the TR
   * mock anchor actually returns for USDC: one lira costs about two cents, so a
   * merchant is shown roughly 48 lira to the dollar.
   *
   * Reading it unflipped is not a rounding error. It priced a 500 lira coffee
   * at 24,095 USDC, and went unnoticed while the only quote server in play was
   * this project's own, inverted the same way.
   */
  it('reads a SEP-38 price in the direction the standard sends it', async () => {
    const fetcher = vi.fn(async () =>
      json({
        buy_assets: [
          {asset: 'iso4217:TRY', price: '0.0207511932', decimals: 2},
          // An anchor that answers with a zero rate has told us nothing, and a
          // merchant offered that currency would price a meal at infinity.
          {asset: 'iso4217:BRL', price: '0'},
        ],
      }),
    ) as unknown as typeof fetch;

    const currencies = await readCurrencyPrices({source: withQuotes, fetcher});

    expect(currencies).toHaveLength(1);
    expect(currencies[0]!.currency).toBe('TRY');
    expect(Number(currencies[0]!.perUnit)).toBeCloseTo(48.19, 1);
    const [url] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('sell_amount=1');
  });

  /**
   * The balance card reads prices straight from `readIndicativePrices`, so it
   * has to divide by the same rate `readCurrencyPrices` inverts. Multiplying
   * priced a 25 lumen wallet at 2.87 lira instead of 224 — small enough to look
   * like a real number, which is what makes it worth a test.
   */
  it('values a holding by dividing, because the price is sold-per-bought', () => {
    expect(currencyValueOfAsset({amount: '25', price: '0.1115'})).toBeCloseTo(224.2, 1);
    expect(currencyValueOfAsset({amount: '25', price: '0'})).toBeNaN();
    expect(currencyValueOfAsset({amount: 'nonsense', price: '0.1115'})).toBeNaN();
  });

  it('converts a lira price through that rate the way the anchor would', async () => {
    const fetcher = vi.fn(async () =>
      json({buy_assets: [{asset: 'iso4217:TRY', price: '0.0207511932', decimals: 2}]}),
    ) as unknown as typeof fetch;

    const [lira] = await readCurrencyPrices({source: withQuotes, fetcher});

    // The anchor's own /price answers 10.2702777 USDC for 500 TRY before fees.
    // Anything near 24,095 means the rate was read upside down.
    const amount = Number(assetAmountForPrice({amount: '500', perUnit: lira!.perUnit}));
    expect(amount).toBeCloseTo(10.375, 1);
  });

  it('converts a price on a menu into the amount that settles it', () => {
    // 500 lira at 13.4 lira per lumen is 37.3134328… lumens.
    expect(assetAmountForPrice({amount: '500', perUnit: '13.4'})).toBe('37.3134329');
  });

  it('rounds up, so a merchant is never handed less than the price', () => {
    // 1 unit at 3 per lumen is 0.333… — rounding down would short the merchant
    // on every single payment.
    expect(assetAmountForPrice({amount: '1', perUnit: '3'})).toBe('0.3333334');
  });

  it('refuses a price or a rate that cannot be paid', () => {
    expect(() => assetAmountForPrice({amount: '0', perUnit: '13.4'})).toThrow(PriceConversionError);
    expect(() => assetAmountForPrice({amount: 'lots', perUnit: '13.4'})).toThrow(PriceConversionError);
    expect(() => assetAmountForPrice({amount: '500', perUnit: '0'})).toThrow(PriceConversionError);
  });

  it('names the currency an anchor identifier stands for', () => {
    expect(assetCodeOf('iso4217:USD')).toBe('USD');
    expect(assetCodeOf('stellar:USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5')).toBe('USDC');
    expect(assetCodeOf('stellar:native')).toBe('XLM');
  });
});
