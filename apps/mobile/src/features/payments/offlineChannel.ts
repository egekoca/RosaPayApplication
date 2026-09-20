import {
  decodeOfflineSessionMessage,
  encodeOfflineSessionMessage,
  type OfflineSessionBody,
} from '@rosapay/protocol';
import {
  releaseProximityPeer,
  sendProximityMessage,
  subscribeToProximityMessages,
} from '../../native/nativeProximity';

/**
 * One phone's end of an offline payment, as a conversation rather than events.
 *
 * The radio delivers whatever arrives whenever it arrives, and both halves of
 * an offline payment are a strict sequence: ask, wait, answer, wait. Writing
 * that as callbacks put the order of the protocol in one place and the handling
 * of it in another, where a message that arrived a moment early was simply
 * dropped. So arrivals are buffered per kind and read with `next`, and the two
 * halves read as what they are — one straight line each.
 */
export type OfflineChannel = {
  send<K extends SessionKind>(kind: K, body: OfflineSessionBody<K>): Promise<void>;
  /** Waits for the next message of a kind, or fails saying what it waited for. */
  next<K extends SessionKind>(kind: K, timeoutMs: number): Promise<OfflineSessionBody<K>>;
  /** Anything of this kind already here, without waiting. */
  taken<K extends SessionKind>(kind: K): OfflineSessionBody<K> | null;
  /** Stops listening. The link is only dropped if `release` is asked for. */
  close(options?: {release?: boolean}): void;
};

type SessionKind = 'payer' | 'authRequest' | 'authorization' | 'result' | 'decline';

export class OfflineChannelError extends Error {
  override readonly name = 'OfflineChannelError';
  constructor(
    readonly code: 'TIMED_OUT' | 'DECLINED' | 'CLOSED' | 'UNREADABLE',
    message: string,
  ) {
    super(message);
  }
}

type Waiter = {
  kind: SessionKind;
  resolve(body: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Opens the conversation with one peer.
 *
 * Addressed, because a counter with two customers in front of it is holding two
 * of these at once and a signature that reached the wrong payment would be a
 * payment nobody made.
 */
export function openOfflineChannel(peerId: string): OfflineChannel {
  const arrived = new Map<SessionKind, unknown[]>();
  let waiters: Waiter[] = [];
  let closed = false;

  const deliver = (kind: SessionKind, body: unknown) => {
    const waiting = waiters.find(waiter => waiter.kind === kind);
    if (waiting) {
      waiters = waiters.filter(waiter => waiter !== waiting);
      clearTimeout(waiting.timer);
      waiting.resolve(body);
      return;
    }
    arrived.set(kind, [...(arrived.get(kind) ?? []), body]);
  };

  const unsubscribe = subscribeToProximityMessages(message => {
    if (closed || message.peerId !== peerId) return;
    // The opening request is how this peer was met; it is not part of the
    // conversation that follows and re-reading it would restart nothing.
    if (message.kind === 'request') return;

    const body = decodeOfflineSessionMessage(message.kind, message.payload);
    if (!body) return;

    // A decline ends whatever anyone is waiting for, and says why. Left to time
    // out instead, the other phone would sit for the full budget over an answer
    // that had already arrived.
    if (message.kind === 'decline') {
      const reason = (body as OfflineSessionBody<'decline'>).reason;
      const pending = waiters;
      waiters = [];
      for (const waiter of pending) {
        clearTimeout(waiter.timer);
        waiter.reject(new OfflineChannelError('DECLINED', reason || 'The other phone stopped this payment'));
      }
      deliver('decline', body);
      return;
    }

    deliver(message.kind, body);
  });

  return {
    send: (kind, body) => sendProximityMessage(peerId, kind, encodeOfflineSessionMessage(kind, body)),

    next: <K extends SessionKind>(kind: K, timeoutMs: number) =>
      new Promise<OfflineSessionBody<K>>((resolve, reject) => {
        if (closed) {
          reject(new OfflineChannelError('CLOSED', 'This payment is no longer listening'));
          return;
        }
        const queued = arrived.get(kind);
        if (queued && queued.length > 0) {
          const [head, ...rest] = queued;
          arrived.set(kind, rest);
          resolve(head as OfflineSessionBody<K>);
          return;
        }
        const waiter: Waiter = {
          kind,
          resolve: body => resolve(body as OfflineSessionBody<K>),
          reject,
          timer: setTimeout(() => {
            waiters = waiters.filter(entry => entry !== waiter);
            reject(new OfflineChannelError('TIMED_OUT', waitingFor(kind)));
          }, timeoutMs),
        };
        waiters = [...waiters, waiter];
      }),

    taken: <K extends SessionKind>(kind: K) => {
      const queued = arrived.get(kind);
      if (!queued || queued.length === 0) return null;
      const [head, ...rest] = queued;
      arrived.set(kind, rest);
      return head as OfflineSessionBody<K>;
    },

    close: options => {
      if (closed) return;
      closed = true;
      unsubscribe();
      const pending = waiters;
      waiters = [];
      for (const waiter of pending) {
        clearTimeout(waiter.timer);
        waiter.reject(new OfflineChannelError('CLOSED', 'This payment stopped before it finished'));
      }
      if (options?.release) void releaseProximityPeer(peerId);
    },
  };
}

/** What a timeout was waiting for, in the words the person in front of it needs. */
function waitingFor(kind: SessionKind): string {
  switch (kind) {
    case 'payer':
      return 'No customer answered this request';
    case 'authRequest':
      return 'The merchant did not send anything to approve';
    case 'authorization':
      return 'The customer did not approve this payment';
    case 'result':
      return 'The merchant did not say whether this payment went through';
    default:
      return 'Nothing came back from the other phone';
  }
}
