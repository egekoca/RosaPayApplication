import {
  Account,
  Address,
  Keypair,
  Networks,
  SorobanDataBuilder,
  StrKey,
  authorizeEntry,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import {Buffer} from 'buffer';
import {describe, expect, it, vi} from 'vitest';

import {
  ContractWebAuthError,
  authenticateContract,
  encodeAuthorizationEntries,
  type AnchorInfo,
  type ContractChallengeSigner,
} from '../src';

const anchorKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 21));
const impostor = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 22));
const source = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 23));
const account = StrKey.encodeContract(Buffer.alloc(32, 24));
const authContract = StrKey.encodeContract(Buffer.alloc(32, 25));
const homeDomain = 'testanchor.example.org';
const authEndpoint = `https://${homeDomain}/auth/contract`;
const latestLedger = 50_000;

function anchorInfo(): AnchorInfo {
  return {
    homeDomain,
    networkPassphrase: Networks.TESTNET,
    signingKey: anchorKey.publicKey(),
    webAuthForContractsEndpoint: authEndpoint,
    webAuthContractId: authContract,
    transferServerSep24: `https://${homeDomain}/sep24`,
    currencies: [{code: 'native'}],
  };
}

function invocation(args: Record<string, string>) {
  const argumentMap = xdr.ScVal.scvMap(
    Object.entries(args).map(([key, value]) => new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol(key),
      val: xdr.ScVal.scvString(value),
    })),
  );
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(authContract).toScAddress(),
        functionName: 'web_auth_verify',
        args: [argumentMap],
      }),
    ),
    subInvocations: [],
  });
}

function unsignedEntry(address: string, root: xdr.SorobanAuthorizedInvocation, nonce: string) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(address).toScAddress(),
        nonce: xdr.Int64.fromString(nonce),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: root,
  });
}

async function challenge(options: {
  serverSigner?: Keypair;
  serverValidUntil?: number;
  argumentOverrides?: Record<string, string>;
} = {}) {
  const args = {
    account,
    home_domain: homeDomain,
    web_auth_domain: homeDomain,
    web_auth_domain_account: anchorKey.publicKey(),
    nonce: 'anchor-nonce',
    ...options.argumentOverrides,
  };
  const client = unsignedEntry(account, invocation(args), '41');
  const server = await authorizeEntry(
    unsignedEntry(anchorKey.publicKey(), invocation(args), '42'),
    options.serverSigner ?? anchorKey,
    options.serverValidUntil ?? latestLedger + 100,
    Networks.TESTNET,
  );
  return encodeAuthorizationEntries([client, server]);
}

function signer(): ContractChallengeSigner & {authorizeEntry: ReturnType<typeof vi.fn>} {
  return {
    accountId: account,
    transactionSourceAccount: source.publicKey(),
    authorizeEntry: vi.fn(async (entry, validUntilLedger, networkPassphrase) =>
      authorizeEntry(
        entry,
        async () => ({signatureScVal: xdr.ScVal.scvBytes(Buffer.alloc(64, 7))}),
        validUntilLedger,
        networkPassphrase,
      ),
    ),
  };
}

function server(simulation: object = {
  transactionData: new SorobanDataBuilder(),
  minResourceFee: '0',
  latestLedger,
  events: [],
  _parsed: true,
}) {
  return {
    getLatestLedger: vi.fn(async () => ({sequence: latestLedger})),
    getAccount: vi.fn(async () => new Account(source.publicKey(), '0')),
    simulateTransaction: vi.fn(async () => simulation),
  } as unknown as rpc.Server;
}

function nonceLedgerKey(address: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
    contract: new Address(address).toScAddress(),
    key: xdr.ScVal.scvLedgerKeyNonce(new xdr.ScNonceKey({nonce: xdr.Int64.fromString('1')})),
    durability: xdr.ContractDataDurability.temporary(),
  }));
}

function fetcherFor(encodedChallenge: string): typeof fetch {
  return vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') return new Response(JSON.stringify({token: 'contract-jwt'}));
    return new Response(JSON.stringify({
      authorization_entries: encodedChallenge,
      network_passphrase: Networks.TESTNET,
    }));
  }) as unknown as typeof fetch;
}

describe('SEP-45 contract authentication', () => {
  it('validates, signs and simulates a genuine challenge before accepting a token', async () => {
    const wallet = signer();
    const rpcServer = server();
    const session = await authenticateContract(anchorInfo(), wallet, {
      rpcUrl: 'https://rpc.example.org',
      rpcServer,
      fetcher: fetcherFor(await challenge()),
    });

    expect(session).toEqual({
      token: 'contract-jwt',
      account,
      homeDomain,
      authProtocol: 'SEP-45',
    });
    expect(wallet.authorizeEntry).toHaveBeenCalledTimes(1);
    expect(rpcServer.simulateTransaction).toHaveBeenCalledTimes(1);
  });

  it('never asks the wallet to sign an impostor-signed challenge', async () => {
    const wallet = signer();
    await expect(authenticateContract(anchorInfo(), wallet, {
      rpcUrl: 'https://rpc.example.org',
      rpcServer: server(),
      fetcher: fetcherFor(await challenge({serverSigner: impostor})),
    })).rejects.toBeInstanceOf(ContractWebAuthError);
    expect(wallet.authorizeEntry).not.toHaveBeenCalled();
  });

  it('never asks the wallet to sign an expired anchor challenge', async () => {
    const wallet = signer();
    await expect(authenticateContract(anchorInfo(), wallet, {
      rpcUrl: 'https://rpc.example.org',
      rpcServer: server(),
      fetcher: fetcherFor(await challenge({serverValidUntil: latestLedger})),
    })).rejects.toThrow(/expired/);
    expect(wallet.authorizeEntry).not.toHaveBeenCalled();
  });

  it('never signs a challenge for another account', async () => {
    const wallet = signer();
    await expect(authenticateContract(anchorInfo(), wallet, {
      rpcUrl: 'https://rpc.example.org',
      rpcServer: server(),
      fetcher: fetcherFor(await challenge({argumentOverrides: {account: authContract}})),
    })).rejects.toThrow(/wrong account/);
    expect(wallet.authorizeEntry).not.toHaveBeenCalled();
  });

  it('rejects a signer that changes the already-approved invocation', async () => {
    const wallet = signer();
    wallet.authorizeEntry.mockImplementation(async entry => {
      const changed = unsignedEntry(account, invocation({
        account,
        home_domain: homeDomain,
        web_auth_domain: homeDomain,
        web_auth_domain_account: anchorKey.publicKey(),
        nonce: 'changed',
      }), '41');
      return authorizeEntry(
        changed,
        async () => ({signatureScVal: xdr.ScVal.scvBytes(Buffer.alloc(64, 7))}),
        latestLedger + 60,
        Networks.TESTNET,
      );
    });
    const rpcServer = server();

    await expect(authenticateContract(anchorInfo(), wallet, {
      rpcUrl: 'https://rpc.example.org',
      rpcServer,
      fetcher: fetcherFor(await challenge()),
    })).rejects.toThrow(/signer changed/);
    expect(rpcServer.simulateTransaction).not.toHaveBeenCalled();
  });

  it('does not exchange a challenge for a token when simulation fails', async () => {
    const wallet = signer();
    const fetcher = fetcherFor(await challenge());
    await expect(authenticateContract(anchorInfo(), wallet, {
      rpcUrl: 'https://rpc.example.org',
      rpcServer: server({error: 'host function failed', events: [], _parsed: true}),
      fetcher,
    })).rejects.toThrow(/failed simulation/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects a nonce write attributed to the web-auth contract itself', async () => {
    const wallet = signer();
    const transactionData = new SorobanDataBuilder().setReadWrite([nonceLedgerKey(authContract)]);
    await expect(authenticateContract(anchorInfo(), wallet, {
      rpcUrl: 'https://rpc.example.org',
      rpcServer: server({transactionData, minResourceFee: '0', latestLedger, events: [], _parsed: true}),
      fetcher: fetcherFor(await challenge()),
    })).rejects.toThrow(/unexpected contract data/);
  });
});
