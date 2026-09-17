import type { ServerEventName, ServerEvents } from '@bolsa/shared';
import { io, type Socket } from 'socket.io-client';

const URL = import.meta.env.VITE_WS_URL ?? '';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting';

/** socket.io types events as listener signatures, not as payloads. */
type ServerListeners = {
  [K in ServerEventName]: (payload: ServerEvents[K]) => void;
};

export type AppSocket = Socket<ServerListeners>;

/**
 * Spec 4.8 and 11.1: the app must always be able to say whether what it is
 * showing is live. A stale price shown as current would break L1 the moment
 * someone tried to buy at it.
 */
export function createSocket(eventId: string): AppSocket {
  return io(URL, {
    withCredentials: true,
    query: { eventId },
    transports: ['websocket', 'polling'],
    reconnectionDelay: 500,
    reconnectionDelayMax: 5_000,
  });
}

/**
 * Subscribes to one server event and returns the unsubscribe function.
 *
 * The cast is confined to these two lines: socket.io resolves its listener
 * type through a conditional that TypeScript cannot evaluate while `K` is still
 * a type parameter. Callers of this function stay fully typed.
 */
export function onServerEvent<K extends ServerEventName>(
  socket: AppSocket,
  event: K,
  handler: (payload: ServerEvents[K]) => void,
): () => void {
  const untyped = socket as unknown as {
    on: (event: string, handler: (payload: unknown) => void) => void;
    off: (event: string, handler: (payload: unknown) => void) => void;
  };

  const listener = handler as (payload: unknown) => void;
  untyped.on(event, listener);
  return () => {
    untyped.off(event, listener);
  };
}
