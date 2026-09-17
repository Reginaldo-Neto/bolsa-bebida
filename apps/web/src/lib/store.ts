import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CartLine {
  productId: string;
  qty: number;
}

interface CartState {
  /** The event the QR Code pointed at. */
  eventId: string | null;
  lines: CartLine[];
  setEventId: (eventId: string) => void;
  add: (productId: string, max: number) => void;
  remove: (productId: string) => void;
  setQty: (productId: string, qty: number, max: number) => void;
  clear: () => void;
  qtyOf: (productId: string) => number;
  totalItems: () => number;
}

/**
 * The cart lives on the phone, never on the server: nothing is reserved until
 * a quote is created (spec 4.4). Persisting it means a dropped connection or a
 * reloaded tab does not cost the participant their basket.
 */
export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      eventId: null,
      lines: [],

      setEventId: (eventId) =>
        set((state) => (state.eventId === eventId ? state : { eventId, lines: [] })),

      add: (productId, max) => {
        const current = get().qtyOf(productId);
        get().setQty(productId, current + 1, max);
      },

      remove: (productId) =>
        set((state) => ({ lines: state.lines.filter((line) => line.productId !== productId) })),

      setQty: (productId, qty, max) =>
        set((state) => {
          const bounded = Math.max(0, Math.min(qty, max));
          if (bounded === 0) {
            return { lines: state.lines.filter((line) => line.productId !== productId) };
          }
          const exists = state.lines.some((line) => line.productId === productId);
          return {
            lines: exists
              ? state.lines.map((line) =>
                  line.productId === productId ? { ...line, qty: bounded } : line,
                )
              : [...state.lines, { productId, qty: bounded }],
          };
        }),

      clear: () => set({ lines: [] }),

      qtyOf: (productId) => get().lines.find((line) => line.productId === productId)?.qty ?? 0,

      totalItems: () => get().lines.reduce((sum, line) => sum + line.qty, 0),
    }),
    { name: 'bolsa-cart' },
  ),
);
