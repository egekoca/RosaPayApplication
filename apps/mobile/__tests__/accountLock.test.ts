import {useAppStore} from '../src/state/appStore';

const initial = useAppStore.getState();

describe('the account and its lock', () => {
  beforeEach(() => {
    useAppStore.setState({...initial, account: null, locked: false, receipts: []});
  });

  it('records who the person is without pretending it is a login', () => {
    useAppStore.getState().createAccount({name: 'Ege Koca', email: 'ege@example.com'});
    const {account, locked} = useAppStore.getState();

    expect(account).toMatchObject({name: 'Ege Koca', email: 'ege@example.com'});
    expect(account?.createdAt).toEqual(expect.any(String));
    // Setting up is itself the proof of presence; asking again straight away
    // would be a prompt with nothing behind it.
    expect(locked).toBe(false);
  });

  it('keeps an account without an email, because email is optional', () => {
    useAppStore.getState().createAccount({name: 'Ege'});
    expect(useAppStore.getState().account).toMatchObject({name: 'Ege'});
    expect(useAppStore.getState().account?.email).toBeUndefined();
  });

  it('locks only when there is an account to lock', () => {
    useAppStore.getState().setRequireUnlock(true);
    useAppStore.getState().lock();
    expect(useAppStore.getState().locked).toBe(false);

    useAppStore.getState().createAccount({name: 'Ege'});
    useAppStore.getState().lock();
    expect(useAppStore.getState().locked).toBe(true);

    useAppStore.getState().unlock();
    expect(useAppStore.getState().locked).toBe(false);
  });

  it('does not stand between someone and their own balance unless they asked it to', () => {
    // Opening the app is not the moment worth protecting; paying is, and paying
    // asks for the device every time regardless of this setting. Demanding a
    // fingerprint to read a balance only teaches people to approve prompts
    // without reading them.
    useAppStore.getState().createAccount({name: 'Ege'});
    useAppStore.getState().lock();
    expect(useAppStore.getState().locked).toBe(false);

    useAppStore.getState().setRequireUnlock(true);
    useAppStore.getState().lock();
    expect(useAppStore.getState().locked).toBe(true);
  });

  it('lets someone back in the moment they turn the challenge off', () => {
    useAppStore.getState().createAccount({name: 'Ege'});
    useAppStore.getState().setRequireUnlock(true);
    useAppStore.getState().lock();

    useAppStore.getState().setRequireUnlock(false);
    expect(useAppStore.getState().locked).toBe(false);
  });

  it('leaves nothing behind when the account is erased', async () => {
    useAppStore.getState().createAccount({name: 'Ege'});
    useAppStore.setState({
      receipts: [
        {
          intentId: 'i',
          merchantName: 'Rose Coffee',
          recipient: 'G',
          amount: '1',
          assetCode: 'XLM',
          network: 'testnet',
          payloadHash: 'h',
          status: 'confirmed',
          transactionHash: 't',
          createdAt: '2026-08-24T00:00:00.000Z',
        },
      ],
      merchantRegisteredOnChain: true,
    });

    await useAppStore.getState().signOut();
    const state = useAppStore.getState();

    expect(state.account).toBeNull();
    expect(state.receipts).toEqual([]);
    expect(state.merchantProfile).toBeNull();
    expect(state.wallet).toBeNull();
    expect(state.merchantRegisteredOnChain).toBe(false);
    expect(state.mode).toBe('customer');
    // Nothing is left locked either, or the next person would face a prompt
    // for an account that no longer exists.
    expect(state.locked).toBe(false);
  });

  it('treats an account alone as a session worth returning to', () => {
    const {hasRestorableSession} = require('../src/state/appStore');
    useAppStore.getState().createAccount({name: 'Ege'});
    expect(hasRestorableSession(useAppStore.getState())).toBe(true);
  });
});

describe('what the lock protects', () => {
  it('keeps the session while locked, so unlocking restores rather than rebuilds', () => {
    useAppStore.getState().createAccount({name: 'Ege'});
    useAppStore.getState().setRequireUnlock(true);
    useAppStore.setState({wallet: {address: 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6', origin: 'created'}});

    useAppStore.getState().lock();
    const locked = useAppStore.getState();

    expect(locked.locked).toBe(true);
    // Locking hides the session; it must never quietly discard it.
    expect(locked.account).not.toBeNull();
    expect(locked.wallet).not.toBeNull();
  });
});
