import type {ProximityMessage} from '../src/native/nativeProximity';

const mockSend = jest.fn().mockResolvedValue(undefined);
const mockRelease = jest.fn().mockResolvedValue(undefined);
let emit: ((message: ProximityMessage) => void) | undefined;

jest.mock('../src/native/nativeProximity', () => ({
  sendProximityMessage: (...args: unknown[]) => mockSend(...args),
  releaseProximityPeer: (...args: unknown[]) => mockRelease(...args),
  subscribeToProximityMessages: (handler: (message: ProximityMessage) => void) => {
    emit = handler;
    return () => {
      emit = undefined;
    };
  },
}));

import {openOfflineChannel, OfflineChannelError} from '../src/features/payments/offlineChannel';

const payer = {
  v: 'RTP/1' as const,
  intentId: 'intent-1',
  payer: 'CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L',
  account: 'smart-wallet' as const,
};

function arrive(message: Partial<ProximityMessage>) {
  emit!({peerId: 'peer-1', kind: 'payer', payload: JSON.stringify(payer), touching: false, ...message} as ProximityMessage);
}

describe('one offline payment, as a conversation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    emit = undefined;
  });

  it('keeps a message that arrives before anyone asks for it', async () => {
    // The radio delivers when it delivers. An answer that landed a moment early
    // used to be dropped, and the phone waiting for it then waited its whole
    // budget out over a message it had already been sent.
    const channel = openOfflineChannel('peer-1');
    arrive({});

    await expect(channel.next('payer', 50)).resolves.toMatchObject({payer: payer.payer});
    channel.close();
  });

  it('answers a waiter as soon as the message lands', async () => {
    const channel = openOfflineChannel('peer-1');
    const waiting = channel.next('payer', 1_000);
    arrive({});

    await expect(waiting).resolves.toMatchObject({intentId: 'intent-1'});
    channel.close();
  });

  it('hears only the phone this payment is with', async () => {
    // Two customers at one till are two conversations, and a signature that
    // reached the wrong one would be a payment nobody made.
    const channel = openOfflineChannel('peer-1');
    arrive({peerId: 'peer-2'});

    await expect(channel.next('payer', 30)).rejects.toBeInstanceOf(OfflineChannelError);
    channel.close();
  });

  it('ignores the opening request, which is how the peer was met', async () => {
    const channel = openOfflineChannel('peer-1');
    arrive({kind: 'request', payload: 'rosapay://pay/abc'});

    await expect(channel.next('payer', 30)).rejects.toMatchObject({code: 'TIMED_OUT'});
    channel.close();
  });

  it('drops a message that does not parse, rather than acting on half of one', async () => {
    const channel = openOfflineChannel('peer-1');
    arrive({payload: 'not json at all'});
    arrive({payload: '{"v":"RTP/2"}'});

    await expect(channel.next('payer', 30)).rejects.toMatchObject({code: 'TIMED_OUT'});
    channel.close();
  });

  it('ends every wait the moment the other phone says no', async () => {
    const channel = openOfflineChannel('peer-1');
    const waiting = channel.next('authorization', 5_000);
    arrive({
      kind: 'decline',
      payload: JSON.stringify({v: 'RTP/1', intentId: 'intent-1', reason: 'Customer cancelled'}),
    });

    await expect(waiting).rejects.toMatchObject({code: 'DECLINED', message: 'Customer cancelled'});
    channel.close();
  });

  it('says what it was waiting for when nothing comes', async () => {
    const channel = openOfflineChannel('peer-1');
    await expect(channel.next('authorization', 20)).rejects.toMatchObject({
      code: 'TIMED_OUT',
      message: 'The customer did not approve this payment',
    });
    channel.close();
  });

  it('stops listening when closed, and only then lets the link go', async () => {
    const channel = openOfflineChannel('peer-1');
    channel.close();
    expect(emit).toBeUndefined();
    expect(mockRelease).not.toHaveBeenCalled();

    const other = openOfflineChannel('peer-2');
    other.close({release: true});
    expect(mockRelease).toHaveBeenCalledWith('peer-2');
  });

  it('addresses everything it sends to its own peer', async () => {
    const channel = openOfflineChannel('peer-1');
    await channel.send('payer', payer);

    expect(mockSend).toHaveBeenCalledWith('peer-1', 'payer', JSON.stringify(payer));
    channel.close();
  });
});
