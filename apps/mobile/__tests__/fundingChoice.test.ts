import {createStellarConfig} from '@rosapay/stellar';
import type {PaymentIntentV1} from '@rosapay/protocol';
import {describeRate, resolveFundingChoice} from '../src/features/payments/fundingChoice';

const config = createStellarConfig('testnet');
const xlm = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const usdc = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const router = 'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD';
const customer = 'CCAATSIEXIHVMYK7B6WGAGAHSBA4CL24XWCJ6RFW4X7MB53ZN2UELNE7';

function intentFor(code: 'XLM' | 'USDC', amount = '0.1'): PaymentIntentV1 {
  return {
    version: 'RTP/1',
    intentId: '11111111-1111-4111-8111-111111111111',
    network: 'testnet',
    merchantProfileId: '22222222-2222-4222-8222-222222222222',
    merchantName: 'Rose Coffee',
    merchantSigningKey: 'GBNBJETCO7VULRWCPOUF5NKVUFEWZ4RS4ULOULSZFEJEXLKULH5L7RPO',
    recipient: 'GA4AB7OZST6NKRYNAJBIYBPV5ZAOIE4QYNEBTMVS6QBAMNVSQ3XGC22H',
    asset:
      code === 'XLM'
        ? {type: 'native', code: 'XLM', decimals: 7}
        : {
            type: 'credit',
            code: 'USDC',
            issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
            decimals: 7,
          },
    amount,
    reference: 'Flat white',
    nonce: 'a'.repeat(32),
    expiresAtLedger: 9_999_999,
    createdAt: '2026-09-06T20:00:00.000Z',
  } as PaymentIntentV1;
}

/** Balances keyed by the token contract the settlement would actually move. */
function balances(held: Record<string, string>) {
  return async (_config: unknown, _holder: string, contractId: string) => {
    const balance = held[contractId];
    // A classic account without a trustline cannot even report a balance, which
    // is the case the production reader throws for.
    if (balance === undefined) throw new Error('no trustline');
    return balance;
  };
}

function quoter(amountIn: bigint) {
  return async (input: {path: string[]; amountOut: bigint; slippageBps?: number}) => ({
    path: input.path,
    amountIn,
    amountOut: input.amountOut,
    amountInMax: (amountIn * 10_050n) / 10_000n,
    slippageBps: input.slippageBps ?? 50,
  });
}

describe('what this wallet can pay with', () => {
  it('pays directly when the wallet holds what the merchant asked for', async () => {
    const choice = await resolveFundingChoice({
      intent: intentFor('XLM'),
      config,
      customerAddress: customer,
      routerContractId: router,
      readBalance: balances({[xlm]: '50', [usdc]: '0'}) as never,
      quote: quoter(1n) as never,
    });

    expect(choice.recommended).toMatchObject({kind: 'direct', spend: '0.1'});
    expect(choice.recommended?.asset.code).toBe('XLM');
  });

  it('offers a swap when the wallet holds only the other asset', async () => {
    const choice = await resolveFundingChoice({
      intent: intentFor('USDC'),
      config,
      customerAddress: customer,
      routerContractId: router,
      readBalance: balances({[xlm]: '52.8', [usdc]: '0'}) as never,
      quote: quoter(9_465_832n) as never,
    });

    expect(choice.recommended).toMatchObject({
      kind: 'swap',
      spend: '0.9465832',
      rate: '9.465832 XLM per USDC',
    });
    // The merchant's amount is untouched by the funding choice.
    expect(choice.recommended?.kind === 'swap' && choice.recommended.funding.path).toEqual([xlm, usdc]);
  });

  it('puts a direct payment ahead of a swap when both would work', async () => {
    const choice = await resolveFundingChoice({
      intent: intentFor('USDC'),
      config,
      customerAddress: customer,
      routerContractId: router,
      readBalance: balances({[xlm]: '52.8', [usdc]: '5'}) as never,
      quote: quoter(9_465_832n) as never,
    });

    expect(choice.options.map(option => option.kind)).toEqual(['direct', 'swap']);
    expect(choice.recommended?.asset.code).toBe('USDC');
  });

  it('will not offer a swap the wallet cannot cover at the ceiling', async () => {
    // The quote is 9.465832 XLM and the ceiling 9.51316; holding 9.5 is enough
    // for the quote and not for what would actually be signed.
    const choice = await resolveFundingChoice({
      intent: intentFor('USDC'),
      config,
      customerAddress: customer,
      routerContractId: router,
      readBalance: balances({[xlm]: '9.5', [usdc]: '0'}) as never,
      quote: quoter(94_658_320n) as never,
    });

    expect(choice.recommended).toBeUndefined();
    expect(choice.options.every(option => option.kind === 'unavailable')).toBe(true);
  });

  it('reads a pool that cannot price the route as unavailable, not as free', async () => {
    const choice = await resolveFundingChoice({
      intent: intentFor('USDC'),
      config,
      customerAddress: customer,
      routerContractId: router,
      readBalance: balances({[xlm]: '52.8', [usdc]: '0'}) as never,
      quote: (async () => {
        throw new Error('no pool');
      }) as never,
    });

    expect(choice.recommended).toBeUndefined();
    expect(choice.options.find(option => option.asset.code === 'XLM')).toMatchObject({
      kind: 'unavailable',
      reason: 'NO_ROUTE',
    });
  });

  it('treats a balance it cannot read as none of that asset', async () => {
    const choice = await resolveFundingChoice({
      intent: intentFor('XLM'),
      config,
      customerAddress: customer,
      routerContractId: router,
      // No USDC entry at all: the reader throws, as it does without a trustline.
      readBalance: balances({[xlm]: '50'}) as never,
      quote: quoter(1n) as never,
    });

    expect(choice.options.find(option => option.asset.code === 'USDC')).toMatchObject({
      kind: 'unavailable',
      held: '0',
    });
  });
});

describe('how long the customer waits for it', () => {
  it('asks every asset at once rather than one after another', async () => {
    /*
     * This runs between a phone reading a request over Bluetooth and the screen
     * that can ask for a fingerprint, so each round trip in it is time someone
     * spends holding two phones together watching nothing happen. Nothing here
     * depends on another asset's answer, and asking in turn made the wait the
     * sum of every balance read.
     */
    let inFlight = 0;
    let highWater = 0;
    const release: Array<() => void> = [];
    const readBalance = async (_config: unknown, _holder: string, contractId: string) => {
      inFlight += 1;
      highWater = Math.max(highWater, inFlight);
      await new Promise<void>(resolve => release.push(resolve));
      inFlight -= 1;
      return contractId === xlm ? '50' : '0';
    };

    const choice = resolveFundingChoice({
      intent: intentFor('XLM'),
      config,
      customerAddress: customer,
      routerContractId: router,
      readBalance: readBalance as never,
      quote: quoter(1n) as never,
    });

    // Both reads have to be outstanding before either is allowed to answer.
    await Promise.resolve();
    expect(highWater).toBeGreaterThan(1);
    release.forEach(resolve => resolve());
    await choice;
  });
});

describe('describing a rate', () => {
  it('reads in the direction a person thinks in', () => {
    expect(describeRate(9_465_832n, 1_000_000n, 'XLM', 'USDC')).toBe('9.465832 XLM per USDC');
  });

  it('says nothing rather than dividing by zero', () => {
    expect(describeRate(1n, 0n, 'XLM', 'USDC')).toBe('');
  });
});
