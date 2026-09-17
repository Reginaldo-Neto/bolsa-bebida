import type { MarketProduct } from '@bolsa/shared';
import { directionOf, formatCents, formatVolume } from '../lib/format';
import { PriceChange } from './price-change';
import { Sparkline } from './sparkline';

const STOCK_LABELS = {
  IN_STOCK: null,
  LOW: 'Ultimas unidades',
  SOLD_OUT: 'Esgotado',
} as const;

export function ProductCard({
  product,
  qty,
  history,
  flash,
  onAdd,
  onRemove,
}: {
  product: MarketProduct;
  qty: number;
  history: number[];
  flash?: 'up' | 'down' | undefined;
  onAdd: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const soldOut = product.stockStatus === 'SOLD_OUT';
  const direction = directionOf(product.changeVsBasePct);

  return (
    <article
      className={`rounded-2xl border border-line bg-surface p-4 ${
        soldOut ? 'opacity-60' : ''
      } ${flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">{product.name}</h3>
          <p className="text-sm text-muted">
            {[formatVolume(product.volumeMl), product.category].filter(Boolean).join(' · ')}
            {!product.isAlcoholic && ' · Sem alcool'}
          </p>
        </div>
        <Sparkline values={history} direction={direction} />
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-price font-bold tabular">{formatCents(product.priceCents)}</p>
          <PriceChange ratio={product.changeVsBasePct} className="text-sm" />
        </div>

        <div className="flex items-center gap-2">
          {qty > 0 && (
            <>
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Remover um ${product.name} do carrinho`}
                className="h-12 w-12 rounded-xl border border-line bg-raised text-xl"
              >
                −
              </button>
              <span aria-live="polite" className="w-6 text-center text-lg font-semibold tabular">
                {qty}
              </span>
            </>
          )}
          <button
            type="button"
            onClick={onAdd}
            disabled={soldOut}
            aria-label={`Adicionar ${product.name} ao carrinho`}
            className="h-12 w-12 rounded-xl bg-accent text-xl font-bold text-bg disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      {/* L2: the published range travels with the price, always. */}
      <p className="mt-3 border-t border-line pt-2 text-sm text-muted tabular">
        Intervalo {formatCents(product.minPriceCents)} – {formatCents(product.maxPriceCents)}
        {STOCK_LABELS[product.stockStatus] && (
          <span className={soldOut ? 'text-down' : 'text-warning'}>
            {' · '}
            {STOCK_LABELS[product.stockStatus]}
          </span>
        )}
      </p>
    </article>
  );
}
