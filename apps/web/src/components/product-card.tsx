import type { MarketProduct } from '@bolsa/shared';
import { useTranslation } from '../i18n';
import { directionOf, isSoftDrinkLabel, useFormatters } from '../lib/format';
import { PriceChange } from './price-change';
import { Sparkline } from './sparkline';

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
  const { t } = useTranslation();
  const format = useFormatters();
  const soldOut = product.stockStatus === 'SOLD_OUT';
  const direction = directionOf(product.changeVsBasePct);

  /**
   * Volume, category and, for a soft drink, the fact that it is one — without
   * saying it twice when the category already does.
   */
  const parts = [format.volume(product.volumeMl), product.category].filter((part): part is string =>
    Boolean(part),
  );
  if (!product.isAlcoholic && !parts.some(isSoftDrinkLabel)) {
    parts.push(t('price.noAlcohol'));
  }

  const stockLabel = soldOut
    ? t('price.soldOut')
    : product.stockStatus === 'LOW'
      ? t('price.lowStock')
      : null;

  return (
    <article
      className={`rounded-2xl border border-line bg-surface p-4 ${
        soldOut ? 'opacity-60' : ''
      } ${flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">{product.name}</h3>
          <p className="text-sm text-muted">{parts.join(' · ')}</p>
        </div>
        <Sparkline values={history} direction={direction} />
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-price font-bold tabular">{format.money(product.priceCents)}</p>
          <PriceChange ratio={product.changeVsBasePct} className="text-sm" />
        </div>

        <div className="flex items-center gap-2">
          {qty > 0 && (
            <>
              <button
                type="button"
                onClick={onRemove}
                aria-label={t('market.removeAria', { name: product.name })}
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
            aria-label={t('market.addAria', { name: product.name })}
            className="h-12 w-12 rounded-xl bg-accent text-xl font-bold text-bg disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      {/* L2: the published range travels with the price, always. */}
      <p className="mt-3 border-t border-line pt-2 text-sm text-muted tabular">
        {t('price.range', {
          min: format.money(product.minPriceCents),
          max: format.money(product.maxPriceCents),
        })}
        {stockLabel && (
          <span className={soldOut ? 'text-down' : 'text-warning'}>
            {' · '}
            {stockLabel}
          </span>
        )}
      </p>
    </article>
  );
}
