import {afterEach, describe, expect, it} from 'vitest';
import {
  Account,
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import {createStellarConfig} from '@rosapay/stellar';
import {buildApp} from '../src/app';
import {RelayerService} from '../src/application/RelayerService';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(app => app.close())));

const relayerKeypair = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
const otherKeypair = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4));
const contractId = StrKey.encodeContract(Buffer.alloc(32, 5));
const otherContractId = StrKey.encodeContract(Buffer.alloc(32, 6));

function config() {
  return createStellarConfig('testnet', {settlementContractId: contractId});
}

function service(overrides: {relayerSecret?: string} = {}) {
  return new RelayerService({
    config: config(),
    relayerSecret: overrides.relayerSecret ?? relayerKeypair.secret(),
  });
}

function invocation(target: string, functionName: string) {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: new Address(target).toScAddress(),
      functionName,
      args: [],
    }),
  );
}

function transaction(options: {source?: Keypair; target?: string; functionName?: string; operations?: number} = {}) {
  const source = options.source ?? relayerKeypair;
  const account = new Account(source.publicKey(), '1');
  const builder = new TransactionBuilder(account, {fee: '100', networkPassphrase: Networks.TESTNET});
  const count = options.operations ?? 1;
  for (let index = 0; index < count; index += 1) {
    builder.addOperation(
      Operation.invokeHostFunction({
        func: invocation(options.target ?? contractId, options.functionName ?? 'settle_payment'),
        auth: [],
      }),
    );
  }
  return builder.setTimeout(30).build().toXDR();
}

describe('relayer service', () => {
  it('signs a settlement transaction it is the source of', () => {
    const {signedXdr} = service().signSettlementTransaction(transaction());
    const signed = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
    expect(signed.signatures).toHaveLength(1);
    expect(StrKey.encodeEd25519PublicKey(signed.signatures[0]!.hint())).toContain('');
  });

  it('refuses to sign a transaction sourced by someone else', () => {
    expect(() => service().signSettlementTransaction(transaction({source: otherKeypair})))
      .toThrow('only signs transactions it is the source of');
  });

  it('refuses another contract or another function', () => {
    expect(() => service().signSettlementTransaction(transaction({target: otherContractId})))
      .toThrow('does not invoke the settlement contract');
    expect(() => service().signSettlementTransaction(transaction({functionName: 'register_merchant'})))
      .toThrow('does not sign register_merchant');
  });

  it('refuses a bundle of operations and malformed input', () => {
    expect(() => service().signSettlementTransaction(transaction({operations: 2})))
      .toThrow('exactly one operation');
    expect(() => service().signSettlementTransaction('not-an-envelope'))
      .toThrow('could not be parsed');
  });

  it('refuses a classic payment operation', () => {
    const account = new Account(relayerKeypair.publicKey(), '1');
    const payment = new TransactionBuilder(account, {fee: '100', networkPassphrase: Networks.TESTNET})
      .addOperation(Operation.payment({destination: otherKeypair.publicKey(), asset: Asset.native(), amount: '1'}))
      .setTimeout(30)
      .build()
      .toXDR();
    expect(() => service().signSettlementTransaction(payment)).toThrow('Only Soroban contract invocations are relayed');
  });

  it('reports the relayer identity over HTTP and rejects blind signing', async () => {
    const app = buildApp({relayer: service()});
    apps.push(app);

    const identity = await app.inject({method: 'GET', url: '/v1/relayer'});
    expect(identity.statusCode).toBe(200);
    expect(identity.json()).toMatchObject({address: relayerKeypair.publicKey(), settlementContractId: contractId});

    const signed = await app.inject({method: 'POST', url: '/v1/relayer/transactions', payload: {xdr: transaction()}});
    expect(signed.statusCode).toBe(200);
    expect(typeof signed.json().signedXdr).toBe('string');

    const refused = await app.inject({
      method: 'POST',
      url: '/v1/relayer/transactions',
      payload: {xdr: transaction({target: otherContractId})},
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().code).toBe('INVALID_TRANSACTION');
  });

  it('reports 503 when no relayer is configured', async () => {
    const app = buildApp({relayer: new RelayerService({config: config()})});
    apps.push(app);
    const response = await app.inject({method: 'GET', url: '/v1/relayer'});
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('RELAYER_DISABLED');
  });
});
