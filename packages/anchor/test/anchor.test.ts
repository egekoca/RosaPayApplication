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
  readTransaction,
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
