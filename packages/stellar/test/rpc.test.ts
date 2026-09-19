import {describe, expect, it, vi} from 'vitest';
import {createStellarConfig} from '../src/config';
import {StellarRpcClient, StellarTransactionError} from '../src/rpc';

const hash = 'a'.repeat(64);

describe('Stellar RPC confirmation guard', () => {
  it('accepts only a successful transaction with a ledger', async () => {
    const client = new StellarRpcClient(createStellarConfig('testnet'));
    vi.spyOn(client.server, 'pollTransaction').mockResolvedValue({
      status: 'SUCCESS',
      txHash: hash,
      ledger: 123,
    } as never);

    await expect(client.confirmTransaction(hash)).resolves.toEqual({txHash: hash, ledger: 123});
  });

  it('rejects not-found and failed results', async () => {
    const client = new StellarRpcClient(createStellarConfig('testnet'));
    vi.spyOn(client.server, 'pollTransaction').mockResolvedValueOnce({status: 'NOT_FOUND', txHash: hash} as never);
    await expect(client.confirmTransaction(hash)).rejects.toMatchObject({code: 'NOT_FOUND'});

    vi.spyOn(client.server, 'pollTransaction').mockResolvedValueOnce({status: 'FAILED', txHash: hash} as never);
    await expect(client.confirmTransaction(hash)).rejects.toMatchObject({code: 'FAILED'});
  });

  it('rejects malformed hashes before touching RPC', async () => {
    const client = new StellarRpcClient(createStellarConfig('testnet'));
    const poll = vi.spyOn(client.server, 'pollTransaction');
    await expect(client.confirmTransaction('short')).rejects.toBeInstanceOf(StellarTransactionError);
    expect(poll).not.toHaveBeenCalled();
  });
});
