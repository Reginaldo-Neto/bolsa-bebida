import type { MarketProduct } from '@bolsa/shared';
import { useQueries } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/chrome';
import { ProductCard } from '../components/product-card';
import { Alert, Button, Spinner, StickyActions } from '../components/ui';
import { useMarket } from '../hooks/use-market';
import { api } from '../lib/api';
import { formatCents } from '../lib/format';
import { useCart } from '../lib/store';

type Filter = 'all' | 'no-alcohol' | string;

/** Spec 11.2: the market. One tap adds a drink; everything else is secondary. */
export function MarketScreen(): React.JSX.Element {
  const eventId = useCart((state) => state.eventId);
  const { snapshot, products, connection, isLoading, error, moved } = useMarket(eventId);
  const [filter, setFilter] = useState<Filter>('all');
  const navigate = useNavigate();

  const lines = useCart((state) => state.lines);
  const add = useCart((state) => state.add);
  const setQty = useCart((state) => state.setQty);

  // The last hour of quotes for each card's sparkline (spec 4.3).
  const histories = useQueries({
    queries: products.map((product) => ({
      queryKey: ['history', product.id],
      queryFn: () => api.history(product.id, new Date(Date.now() - 3_600_000).toISOString()),
      staleTime: 60_000,
    })),
  });

  const historyByProduct = useMemo(() => {
    const map: Record<string, number[]> = {};
    products.forEach((product, index) => {
      map[product.id] = (histories[index]?.data ?? []).map((point) => point.priceCents);
    });
    return map;
  }, [products, histories]);

  const categories = useMemo(
    () => [...new Set(products.map((product) => product.category).filter(Boolean))] as string[],
    [products],
  );

  const visible = products.filter((product) => {
    if (filter === 'all') return true;
    if (filter === 'no-alcohol') return !product.isAlcoholic;
    return product.category === filter;
  });

  const cartTotal = lines.reduce((sum, line) => {
    const product = products.find((candidate) => candidate.id === line.productId);
    return sum + (product ? product.priceCents * line.qty : 0);
  }, 0);

  const itemCount = lines.reduce((sum, line) => sum + line.qty, 0);
  const maxPerProduct = 4;

  if (isLoading) {
    return <Spinner label="A carregar o mercado" />;
  }

  if (error) {
    return (
      <div className="p-4">
        <Alert tone="error">Nao foi possivel carregar o mercado. Verifique a ligacao.</Alert>
      </div>
    );
  }

  const paused = snapshot?.status === 'PAUSED' || snapshot?.fixedPrices;
  const closed = snapshot?.status === 'CLOSED_SALES' || snapshot?.status === 'FINISHED';

  return (
    <>
      <AppHeader title={snapshot?.eventName ?? 'Mercado'} connection={connection} />

      <main className="mx-auto max-w-lg px-4 pb-4">
        {paused && (
          <div className="mt-3">
            <Alert tone="warning">
              Cotacoes congeladas neste momento. Pode continuar a comprar aos precos apresentados.
            </Alert>
          </div>
        )}
        {closed && (
          <div className="mt-3">
            <Alert tone="warning">
              As vendas estao fechadas. Os vouchers ja emitidos continuam validos.
            </Alert>
          </div>
        )}

        <div
          role="group"
          aria-label="Filtrar bebidas"
          className="scrollbar-none -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1"
        >
          {[
            { key: 'all', label: 'Todas' },
            { key: 'no-alcohol', label: 'Sem alcool' },
            ...categories.map((category) => ({ key: category, label: category })),
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={filter === option.key}
              onClick={() => setFilter(option.key)}
              className={`min-h-10 shrink-0 rounded-full border px-4 text-sm ${
                filter === option.key
                  ? 'border-accent bg-accent text-bg'
                  : 'border-line bg-surface text-muted'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="mt-3 space-y-3">
          {visible.map((product: MarketProduct) => (
            <ProductCard
              key={product.id}
              product={product}
              qty={lines.find((line) => line.productId === product.id)?.qty ?? 0}
              history={historyByProduct[product.id] ?? []}
              flash={moved[product.id]}
              onAdd={() => add(product.id, maxPerProduct)}
              onRemove={() =>
                setQty(
                  product.id,
                  (lines.find((line) => line.productId === product.id)?.qty ?? 0) - 1,
                  maxPerProduct,
                )
              }
            />
          ))}
        </div>

        {visible.length === 0 && (
          <p className="py-10 text-center text-muted">Nenhuma bebida neste filtro.</p>
        )}

        {itemCount > 0 && (
          <StickyActions>
            <Button className="w-full" onClick={() => void navigate('/carrinho')}>
              Ver carrinho · {itemCount} {itemCount === 1 ? 'bebida' : 'bebidas'} ·{' '}
              {formatCents(cartTotal)}
            </Button>
          </StickyActions>
        )}
      </main>
    </>
  );
}
