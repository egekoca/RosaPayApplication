import {afterEach, describe, expect, it} from 'vitest';
import {Keypair} from '@stellar/stellar-sdk';
import {createStellarConfig} from '@rosapay/stellar';
import {buildApp} from '../src/app';
import {WalletProvisioningService} from '../src/application/WalletProvisioningService';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map(app => app.close())));

const devicePublicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 7)]).toString('base64');

describe('wallet provisioning', () => {
  it('reports 503 when the deployment cannot create wallets', async () => {
    const app = buildApp({wallets: new WalletProvisioningService({config: createStellarConfig('testnet')})});
    apps.push(app);

    const response = await app.inject({method: 'POST', url: '/v1/wallets', payload: {devicePublicKey}});
    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe('WALLET_PROVISIONING_DISABLED');
  });

  it('rejects a device key that is not an uncompressed point', async () => {
    const service = new WalletProvisioningService({
      config: createStellarConfig('testnet'),
      walletWasmHash: 'aa'.repeat(32),
      deployerSecret: Keypair.random().secret(),
    });
    const app = buildApp({wallets: service});
    apps.push(app);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/wallets',
      payload: {devicePublicKey: Buffer.alloc(65, 9).toString('base64')},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('INVALID_DEVICE_KEY');
  });

  it('validates the request body before touching the network', async () => {
    const app = buildApp();
    apps.push(app);
    const response = await app.inject({method: 'POST', url: '/v1/wallets', payload: {devicePublicKey: 'short'}});
    expect(response.statusCode).toBe(400);
  });
});
