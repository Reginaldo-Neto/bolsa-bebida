import type { MarketProduct } from '@bolsa/shared';
import { useQueries } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/chrome';
import { ProductCard } from '../components/product-card';
import { Alert, Button, Spinner, StickyActions } from '../components/ui';
import { useMarket } from '../hooks/use-market';
import { useTranslation } from '../i18n';
import { api } from '../lib/api';
import { isSoftDrinkLabel, useFormatters } from '../lib/format';
import { useCart } from '../lib/store';

type Filter = 'all' | 'no-alcohol' | string;

const MAX_PER_PRODUCT = 4;

/** Spec 11.2: the market. One tap adds a drink; everything else is secondary. */
export function MarketScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const format = useFormatters();
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

  /**
   * "No alcohol" is both a quick filter and, in most catalogues, a category.
   * Listing both puts the same chip on screen twice, so the category yields to
   * the filter that already covers it.
   */
  const categories = useMemo(() => {
    const names = new Set(
      products.map((product) => product.category).filter((name): name is string => Boolean(name)),
    );
    return [...names].filter((name) => !isSoftDrinkLabel(name));
  }, [products]);

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

  if (isLoading) {
    return <Spinner label={t('market.loading')} />;
  }

  if (error) {
    return (
      <div className="p-4">
        <Alert tone="error">{t('market.error')}</Alert>
      </div>
    );
  }

  const paused = snapshot?.status === 'PAUSED' || snapshot?.fixedPrices;
  const closed = snapshot?.status === 'CLOSED_SALES' || snapshot?.status === 'FINISHED';

  return (
    <>
      <AppHeader title={snapshot?.eventName ?? t('market.title')} connection={connection} />

      <main className="mx-auto max-w-lg px-4 pb-4">
        {paused && (
          <div className="mt-3">
            <Alert tone="warning">{t('market.paused')}</Alert>
          </div>
        )}
        {closed && (
          <div className="mt-3">
            <Alert tone="warning">{t('market.closed')}</Alert>
          </div>
        )}

        <div
          role="group"
          aria-label={t('market.filterAria')}
          className="scrollbar-none -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1"
        >
          {[
            { key: 'all', label: t('market.filterAll') },
            { key: 'no-alcohol', label: t('price.noAlcohol') },
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
              onAdd={() => add(product.id, MAX_PER_PRODUCT)}
              onRemove={() =>
                setQty(
                  product.id,
                  (lines.find((line) => line.productId === product.id)?.qty ?? 0) - 1,
                  MAX_PER_PRODUCT,
                )
              }
            />
          ))}
        </div>

        {visible.length === 0 && (
          <p className="py-10 text-center text-muted">{t('market.empty')}</p>
        )}

        {itemCount > 0 && (
          <StickyActions>
            <Button className="w-full" onClick={() => void navigate('/carrinho')}>
              {t('market.viewCart', {
                count:
                  itemCount === 1
                    ? t('market.drinkOne', { count: itemCount })
                    : t('market.drinkMany', { count: itemCount }),
                total: format.money(cartTotal),
              })}
            </Button>
          </StickyActions>
        )}
      </main>
    </>
  );
}
