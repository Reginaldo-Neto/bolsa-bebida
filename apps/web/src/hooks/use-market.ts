import type { MarketProduct, MarketSnapshot } from '@bolsa/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { createSocket, onServerEvent, type AppSocket, type ConnectionState } from '../lib/socket';

export interface MarketView {
  snapshot: MarketSnapshot | undefined;
  products: MarketProduct[];
  connection: ConnectionState;
  isLoading: boolean;
  error: Error | null;
  /** Products whose price moved on the last tick, for the flash animation. */
  moved: Record<string, 'up' | 'down'>;
}

/**
 * Live prices for one event.
 *
 * Two rules from spec 8.3 are enforced here: a tick older than the last one
 * seen is discarded, and every reconnection refetches the snapshot rather than
 * trusting whatever was on screen.
 */
export function useMarket(eventId: string | null): MarketView {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [moved, setMoved] = useState<Record<string, 'up' | 'down'>>({});
  const lastTick = useRef(-1);
  const socketRef = useRef<AppSocket | null>(null);

  const query = useQuery({
    queryKey: ['market', eventId],
    queryFn: () => api.snapshot(eventId ?? ''),
    enabled: Boolean(eventId),
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!eventId) {
      return;
    }

    const socket = createSocket(eventId);
    socketRef.current = socket;
    lastTick.current = -1;

    socket.on('connect', () => {
      setConnection('live');
      // Spec 8.3: never carry prices across a gap in the stream.
      void queryClient.invalidateQueries({ queryKey: ['market', eventId] });
    });
    socket.on('disconnect', () => setConnection('reconnecting'));
    socket.io.on('reconnect_attempt', () => setConnection('reconnecting'));

    const offTick = onServerEvent(socket, 'market.tick', (payload) => {
      if (payload.tick <= lastTick.current) {
        return;
      }
      lastTick.current = payload.tick;

      const changes: Record<string, 'up' | 'down'> = {};

      queryClient.setQueryData<MarketSnapshot>(['market', eventId], (previous) => {
        if (!previous) {
          return previous;
        }

        const updates = new Map(payload.products.map((product) => [product.id, product]));
        return {
          ...previous,
          tick: payload.tick,
          products: previous.products.map((product) => {
            const update = updates.get(product.id);
            if (!update) {
              return product;
            }
            if (update.priceCents !== product.priceCents) {
              changes[product.id] = update.priceCents > product.priceCents ? 'up' : 'down';
            }
            return {
              ...product,
              priceCents: update.priceCents,
              changeVsBasePct: update.changeVsBasePct,
              stockStatus: update.stockStatus,
            };
          }),
        };
      });

      setMoved(changes);
    });

    const offState = onServerEvent(socket, 'market.state', (payload) => {
      queryClient.setQueryData<MarketSnapshot>(['market', eventId], (previous) =>
        previous
          ? { ...previous, status: payload.status, fixedPrices: payload.fixedPrices }
          : previous,
      );
    });

    const offSoldOut = onServerEvent(socket, 'product.soldout', (payload) => {
      queryClient.setQueryData<MarketSnapshot>(['market', eventId], (previous) =>
        previous
          ? {
              ...previous,
              products: previous.products.map((product) =>
                product.id === payload.productId
                  ? { ...product, stockStatus: 'SOLD_OUT' as const }
                  : product,
              ),
            }
          : previous,
      );
    });

    return () => {
      offTick();
      offState();
      offSoldOut();
      socket.close();
      socketRef.current = null;
    };
  }, [eventId, queryClient]);

  return {
    snapshot: query.data,
    products: query.data?.products ?? [],
    connection,
    isLoading: query.isLoading,
    error: query.error,
    moved,
  };
}
