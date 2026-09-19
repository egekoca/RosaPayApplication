import {z} from 'zod';

/**
 * SEP-1 discovery. Everything Lumenade Pay later trusts about an anchor — where to
 * authenticate, which key signs its challenges, which assets it handles — comes
 * from this one file, so it is fetched over HTTPS from the anchor's own domain
 * and parsed strictly rather than believed.
 */
export type AnchorCurrency = {
  code: string;
  /** Absent for the native asset. */
  issuer?: string;
  status?: string;
};

export type AnchorInfo = {
  homeDomain: string;
  networkPassphrase: string;
  /** The key whose signature makes a SEP-10 challenge genuine. */
  signingKey: string;
  webAuthEndpoint?: string;
  transferServerSep24?: string;
  /**
   * SEP-6, the programmatic deposit and withdrawal door.
   *
   * Read alongside SEP-24 rather than instead of it: the two are different
   * protocols, not versions of one. SEP-24 hands the customer a hosted page and
   * SEP-6 hands the wallet the bank details to render itself, and an anchor may
   * publish either or both. The lira anchor publishes only this one.
   */
  transferServerSep6?: string;
  kycServer?: string;
  quoteServer?: string;
  /** SEP-45, for authenticating a contract account rather than a classic one. */
  webAuthForContractsEndpoint?: string;
  webAuthContractId?: string;
  currencies: AnchorCurrency[];
};

export type AnchorDiscoveryErrorCode =
  | 'INSECURE_DOMAIN'
  | 'UNREACHABLE'
  | 'MALFORMED_TOML'
  | 'INCOMPLETE_ANCHOR';

export class AnchorDiscoveryError extends Error {
  override readonly name = 'AnchorDiscoveryError';
  constructor(readonly code: AnchorDiscoveryErrorCode, message: string) {
    super(message);
  }
}

const stellarAddress = z.string().regex(/^G[A-Z2-7]{55}$/);

/**
 * A minimal TOML reader for the subset SEP-1 uses: bare `KEY = "value"` pairs
 * and repeated `[[CURRENCIES]]` tables. A general TOML parser would be a
 * dependency and a parsing surface for a file fetched from a third party; this
 * reads only the shapes the standard defines and ignores everything else.
 */
export function parseStellarToml(source: string): {
  values: Record<string, string>;
  currencies: Record<string, string>[];
} {
  const values: Record<string, string> = {};
  const currencies: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;

    if (line === '[[CURRENCIES]]') {
      current = {};
      currencies.push(current);
      continue;
    }
    if (line.startsWith('[')) {
      // Any other table ends the currency we were reading.
      current = null;
      continue;
    }

    const match = /^([A-Za-z0-9_]+)\s*=\s*(.+)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = readValue(rawValue!);
    if (value === null) continue;
    (current ?? values)[key!] = value;
  }

  return {values, currencies};
}

/** Reads a quoted string or the first entry of a simple array. */
function readValue(raw: string): string | null {
  const quoted = /^"([^"]*)"/.exec(raw.trim());
  if (quoted) return quoted[1]!;
  const array = /^\[\s*"([^"]*)"/.exec(raw.trim());
  if (array) return array[1]!;
  const bare = raw.trim();
  return bare.length > 0 && !bare.startsWith('[') ? bare : null;
}

export type DiscoverAnchorOptions = {
  fetcher?: typeof fetch;
  /** Escape hatch for tests against a local server; production must stay HTTPS. */
  allowInsecure?: boolean;
};

export async function discoverAnchor(
  homeDomain: string,
  {fetcher = fetch, allowInsecure = false}: DiscoverAnchorOptions = {},
): Promise<AnchorInfo> {
  const domain = homeDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!allowInsecure && !/^[a-z0-9.-]+$/i.test(domain)) {
    throw new AnchorDiscoveryError('INSECURE_DOMAIN', `${homeDomain} is not a domain Lumenade Pay will talk to`);
  }

  const url = `${allowInsecure ? 'http' : 'https'}://${domain}/.well-known/stellar.toml`;
  let source: string;
  try {
    const response = await fetcher(url);
    if (!response.ok) {
      throw new AnchorDiscoveryError('UNREACHABLE', `${domain} did not publish a stellar.toml (${response.status})`);
    }
    source = await response.text();
  } catch (error) {
    if (error instanceof AnchorDiscoveryError) throw error;
    throw new AnchorDiscoveryError('UNREACHABLE', `${domain} could not be reached`);
  }

  const {values, currencies} = parseStellarToml(source);
  const signingKey = stellarAddress.safeParse(values.SIGNING_KEY);
  if (!signingKey.success) {
    throw new AnchorDiscoveryError(
      'INCOMPLETE_ANCHOR',
      `${domain} publishes no usable SIGNING_KEY, so its challenges could not be trusted`,
    );
  }
  if (!values.NETWORK_PASSPHRASE) {
    throw new AnchorDiscoveryError('INCOMPLETE_ANCHOR', `${domain} does not say which network it serves`);
  }

  const webAuthEndpoint = secureEndpoint(values.WEB_AUTH_ENDPOINT, domain, 'WEB_AUTH_ENDPOINT');
  const transferServerSep24 = secureEndpoint(
    values.TRANSFER_SERVER_SEP0024,
    domain,
    'TRANSFER_SERVER_SEP0024',
  );
  const transferServerSep6 = secureEndpoint(values.TRANSFER_SERVER, domain, 'TRANSFER_SERVER');
  const kycServer = secureEndpoint(values.KYC_SERVER, domain, 'KYC_SERVER');
  const quoteServer = secureEndpoint(values.ANCHOR_QUOTE_SERVER, domain, 'ANCHOR_QUOTE_SERVER');
  const webAuthForContractsEndpoint = secureEndpoint(
    values.WEB_AUTH_FOR_CONTRACTS_ENDPOINT,
    domain,
    'WEB_AUTH_FOR_CONTRACTS_ENDPOINT',
  );

  return {
    homeDomain: domain,
    networkPassphrase: values.NETWORK_PASSPHRASE,
    signingKey: signingKey.data,
    ...(webAuthEndpoint ? {webAuthEndpoint} : {}),
    ...(transferServerSep24 ? {transferServerSep24} : {}),
    ...(transferServerSep6 ? {transferServerSep6} : {}),
    ...(kycServer ? {kycServer} : {}),
    ...(quoteServer ? {quoteServer} : {}),
    ...(webAuthForContractsEndpoint ? {webAuthForContractsEndpoint} : {}),
    ...(values.WEB_AUTH_CONTRACT_ID ? {webAuthContractId: values.WEB_AUTH_CONTRACT_ID} : {}),
    currencies: currencies
      .filter(currency => typeof currency.code === 'string')
      .map(currency => ({
        code: currency.code!,
        ...(currency.issuer ? {issuer: currency.issuer} : {}),
        ...(currency.status ? {status: currency.status} : {}),
      })),
  };
}

function secureEndpoint(value: string | undefined, domain: string, field: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.toString().replace(/\/$/, '');
  } catch {
    // Converted to the stable discovery error below.
  }
  throw new AnchorDiscoveryError(
    'INCOMPLETE_ANCHOR',
    `${domain} publishes no usable HTTPS ${field}`,
  );
}
