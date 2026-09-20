import {Address, Keypair, Networks, StrKey, hash, nativeToScVal, scValToNative, xdr} from '@stellar/stellar-sdk';
import {p256} from '@noble/curves/nist.js';
import {describe, expect, it, vi} from 'vitest';
import {Buffer} from 'buffer';

import {
  OfflineAuthorizationError,
  assertAuthorizationMatchesIntent,
  authorizeOffline,
  buildSettlementEnvelope,
  prepareAuthorizationRequest,
  type UnsignedAuthRequest,
} from '../src';

const settlementContractId = StrKey.encodeContract(Buffer.alloc(32, 5));
const customerAddress = StrKey.encodeContract(Buffer.alloc(32, 9));
const recipient = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();
const networkPassphrase = Networks.TESTNET;
const signatureExpirationLedger = 1_500_200;

function paymentIntent(overrides: Record<string, unknown> = {}) {
  return {
    version: 'RTP/1' as const,
    intentId: '01K36YB37NXM4X4TECF0VKP1M9',
    network: 'testnet' as const,
    merchantProfileId: '01K36YATYFVQBPR08G2YT29C3S',
    merchantName: 'Rose Coffee',
    merchantSigningKey: recipient,
    recipient,
    asset: {type: 'native' as const, code: 'XLM', decimals: 7},
    amount: '24.5',
    reference: 'Table 08',
    nonce: 'b9cdb790ee6a4d04a83763c018f532a8',
    expiresAtLedger: 1_500_120,
    createdAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  };
}

/** Builds the entry a merchant's simulation would hand over. */
function authRequest(intent = paymentIntent(), payer = customerAddress): UnsignedAuthRequest {
  const envelope = buildSettlementEnvelope(intent, {
    customer: payer,
    networkPassphrase,
    settlementContractId,
  });
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(payer).toScAddress(),
        nonce: xdr.Int64.fromString('42'),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: new Address(settlementContractId).toScAddress(),
          functionName: 'settle_payment',
          args: [nativeToScVal(envelope.intent), xdr.ScVal.scvBytes(Buffer.alloc(64, 1))],
        }),
      ),
      subInvocations: [],
    }),
  });

  return {
    version: 'RTP/1',
    networkPassphrase,
    settlementContractId,
    entryXdr: entry.toXDR('base64'),
    signatureExpirationLedger,
  };
}

/** Platform keystores return ASN.1 DER, so the fake hardware signer does too. */
function toDer(compact: Uint8Array): Uint8Array {
  const encodeInteger = (value: Uint8Array) => {
    let bytes = value;
    while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
    const padded = (bytes[0] ?? 0) & 0x80 ? Uint8Array.from([0, ...bytes]) : bytes;
    return Uint8Array.from([0x02, padded.length, ...padded]);
  };
  const body = Uint8Array.from([
    ...encodeInteger(compact.subarray(0, 32)),
    ...encodeInteger(compact.subarray(32)),
  ]);
  return Uint8Array.from([0x30, body.length, ...body]);
}

/** A hardware key that signs, and records that it was asked. */
function deviceSigner() {
  const secretKey = Uint8Array.from(Buffer.alloc(32, 11));
  return {
    publicKey: Buffer.from(p256.getPublicKey(secretKey, false)).toString('base64'),
    signDigest: vi.fn(async ({digest}: {digest: string}) => {
      const signature = p256.sign(Uint8Array.from(Buffer.from(digest, 'base64')), secretKey, {
        prehash: false,
        lowS: true,
      });
      return {signature: Buffer.from(toDer(signature)).toString('base64')};
    }),
  };
}

describe('authorizing a payment with no network', () => {
  it('accepts the payment it is showing', () => {
    expect(() =>
      assertAuthorizationMatchesIntent(authRequest(), paymentIntent(), {customerAddress}),
    ).not.toThrow();
  });

  it('signs without asking anything of the network', async () => {
    const signer = deviceSigner();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const authorization = await authorizeOffline({
      request: authRequest(),
      intent: paymentIntent(),
      customerAddress,
      signer,
    });

    // The whole point: a phone in airplane mode can produce this.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(signer.signDigest).toHaveBeenCalledTimes(1);
    expect(authorization.authorizer).toBe(customerAddress);
    expect(authorization.signatureExpirationLedger).toBe(signatureExpirationLedger);
    fetchSpy.mockRestore();
  });

  it('carries the signature and the expiry back in the entry', async () => {
    const authorization = await authorizeOffline({
      request: authRequest(),
      intent: paymentIntent(),
      customerAddress,
      signer: deviceSigner(),
    });

    const entry = xdr.SorobanAuthorizationEntry.fromXDR(authorization.entryXdr, 'base64');
    const credentials = entry.credentials().address();
    expect(credentials.signatureExpirationLedger()).toBe(signatureExpirationLedger);
    expect(credentials.signature().switch().name).not.toBe('scvVoid');
  });
});

describe('refusing to sign the wrong thing', () => {
  it('refuses an amount that is not the one on screen', () => {
    // The merchant is showing 24.5 and trying to have 245.5 authorized.
    const tampered = authRequest(paymentIntent({amount: '245.5'}));

    expect(() => assertAuthorizationMatchesIntent(tampered, paymentIntent(), {customerAddress}))
      .toThrow(/amount differs/);
  });

  it('refuses a recipient that is not the one on screen', () => {
    const otherRecipient = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4)).publicKey();
    const swapped = authRequest(paymentIntent({recipient: otherRecipient}));

    expect(() => assertAuthorizationMatchesIntent(swapped, paymentIntent(), {customerAddress}))
      .toThrow(/recipient differs/);
  });

  it('refuses an authorization addressed to someone else', () => {
    const otherPayer = StrKey.encodeContract(Buffer.alloc(32, 8));
    const request = authRequest(paymentIntent(), otherPayer);

    expect(() => assertAuthorizationMatchesIntent(request, paymentIntent(), {customerAddress}))
      .toThrow(OfflineAuthorizationError);
  });

  it('refuses a call to another contract', () => {
    const request = authRequest();
    const entry = xdr.SorobanAuthorizationEntry.fromXDR(request.entryXdr, 'base64');
    entry
      .rootInvocation()
      .function()
      .contractFn()
      .contractAddress(new Address(StrKey.encodeContract(Buffer.alloc(32, 7))).toScAddress());

    expect(() =>
      assertAuthorizationMatchesIntent(
        {...request, entryXdr: entry.toXDR('base64')},
        paymentIntent(),
        {customerAddress},
      ),
    ).toThrow(/another settlement contract/);
  });

  it('refuses a request the ledger has already passed', () => {
    expect(() =>
      assertAuthorizationMatchesIntent(authRequest(), paymentIntent(), {
        customerAddress,
        latestLedger: signatureExpirationLedger + 1,
      }),
    ).toThrow(/already expired/);
  });

  it('refuses something that is not an authorization at all', () => {
    expect(() =>
      assertAuthorizationMatchesIntent(
        {
          version: 'RTP/1',
          networkPassphrase,
          settlementContractId,
          entryXdr: 'not-xdr',
          signatureExpirationLedger,
        },
        paymentIntent(),
        {customerAddress},
      ),
    ).toThrow(/could not be read/);
  });

  it('never asks the device to sign what it refused', async () => {
    const signer = deviceSigner();

    await expect(
      authorizeOffline({
        request: authRequest(paymentIntent({amount: '245.5'})),
        intent: paymentIntent(),
        customerAddress,
        signer,
      }),
    ).rejects.toThrow(OfflineAuthorizationError);

    // A prompt the customer approves must never be for a payment we rejected.
    expect(signer.signDigest).not.toHaveBeenCalled();
  });
});

describe('a merchant preparing what the customer signs', () => {
  it('refuses to prepare a request the customer is not asked to authorize', () => {
    expect(() =>
      prepareAuthorizationRequest({
        transaction: {needsNonInvokerSigningBy: () => [], toXDR: () => ''},
        customerAddress,
        networkPassphrase,
        settlementContractId,
        signatureExpirationLedger,
      }),
    ).toThrow(/does not ask the named customer/);
  });
it('lets an account held as twelve words sign offline, the way a wallet extension does', async () => {
    // The key is on the phone either way. A classic account signs the hash of
    // the authorization preimage — entirely local arithmetic — and refusing it
    // would have meant only wallets this app created could pay without a
    // network, which was arbitrary rather than a security boundary.
    const keypair = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 11));
    const intent = paymentIntent();
    const request = authRequest(intent, keypair.publicKey());
    let signedPreimage: string | undefined;

    const authorization = await authorizeOffline({
      request,
      intent,
      customerAddress: keypair.publicKey(),
      accountSigner: {
        async signAuthEntry(preimageXdr) {
          signedPreimage = preimageXdr;
          const payload = hash(Buffer.from(preimageXdr, 'base64'));
          return {signedAuthEntry: keypair.sign(payload).toString('base64')};
        },
      },
    });

    expect(signedPreimage).toBeDefined();
    expect(authorization.authorizer).toBe(keypair.publicKey());
    expect(authorization.signatureExpirationLedger).toBe(signatureExpirationLedger);

    // The signature has to reach the host in the shape it checks: a vector of
    // {public_key, signature}, over the preimage the expiry was written into.
    const signed = xdr.SorobanAuthorizationEntry.fromXDR(authorization.entryXdr, 'base64');
    const credentials = signed.credentials().address();
    expect(credentials.signatureExpirationLedger()).toBe(signatureExpirationLedger);
    const [entry] = scValToNative(credentials.signature()) as Array<{
      public_key: Uint8Array;
      signature: Uint8Array;
    }>;
    expect(Buffer.from(entry!.public_key)).toEqual(
      Buffer.from(StrKey.decodeEd25519PublicKey(keypair.publicKey())),
    );
    const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
      new xdr.HashIdPreimageSorobanAuthorization({
        networkId: hash(Buffer.from(networkPassphrase, 'utf8')),
        nonce: credentials.nonce(),
        signatureExpirationLedger: signatureExpirationLedger,
        invocation: signed.rootInvocation(),
      }),
    );
    expect(keypair.verify(hash(preimage.toXDR()), Buffer.from(entry!.signature))).toBe(true);
  });

  it('checks a classic entry against the intent before it signs anything', async () => {
    const keypair = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 12));
    const intent = paymentIntent();
    const request = authRequest(intent, keypair.publicKey());
    const signAuthEntry = vi.fn();

    await expect(
      authorizeOffline({
        request,
        intent: paymentIntent({amount: '1'}),
        customerAddress: keypair.publicKey(),
        accountSigner: {signAuthEntry},
      }),
    ).rejects.toBeInstanceOf(OfflineAuthorizationError);
    expect(signAuthEntry).not.toHaveBeenCalled();
  });

  it('refuses a payment it has no key at all to sign', async () => {
    const intent = paymentIntent();
    await expect(
      authorizeOffline({request: authRequest(intent), intent, customerAddress}),
    ).rejects.toBeInstanceOf(OfflineAuthorizationError);
  });
});
