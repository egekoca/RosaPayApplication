import {afterEach, describe, expect, it} from 'vitest';
import {Keypair} from '@stellar/stellar-sdk';
import {createStellarConfig} from '@rosapay/stellar';
import {buildApp} from '../src/app';
import {WalletProvisioningService} from '../src/application/WalletProvisioningService';
import {InMemoryWalletRepository} from '../src/application/WalletRepository';

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

describe('wallet reuse and limits', () => {
  const devicePoint = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 3)]).toString('base64');

  it('returns the wallet a device already controls instead of funding another', async () => {
    const wallets = new InMemoryWalletRepository();
    await wallets.save({
      contractAddress: 'CCAATSIEXIHVMYK7B6WGAGAHSBA4CL24XWCJ6RFW4X7MB53ZN2UELNE7',
      publicSigner: devicePoint,
      network: 'testnet',
      status: 'active',
    });
    const service = new WalletProvisioningService({
      config: createStellarConfig('testnet'),
      wallets,
      walletWasmHash: 'aa'.repeat(32),
      deployerSecret: Keypair.random().secret(),
    });

    const provisioned = await service.provision(devicePoint);

    expect(provisioned).toMatchObject({
      walletContractId: 'CCAATSIEXIHVMYK7B6WGAGAHSBA4CL24XWCJ6RFW4X7MB53ZN2UELNE7',
      reused: true,
      fundedAmount: '0',
    });
  });

  it('stops a caller from driving wallet creation in a loop', async () => {
    const wallets = new InMemoryWalletRepository();
    const app = buildApp({
      wallets: new WalletProvisioningService({config: createStellarConfig('testnet'), wallets}),
    });
    apps.push(app);

    // Provisioning is disabled here, so every call fails the same way until the
    // limiter takes over; the point is that the limiter does take over.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({method: 'POST', url: '/v1/wallets', payload: {devicePublicKey: devicePoint}});
      statuses.push(response.statusCode);
    }

    expect(statuses.slice(0, 3)).toEqual([503, 503, 503]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });
});
