import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/chrome';
import { Alert, Button, Card, StickyActions } from '../components/ui';
import { useMarket } from '../hooks/use-market';
import { useTranslation } from '../i18n';
import { useFormatters } from '../lib/format';
import { useCart } from '../lib/store';

const MAX_PER_PRODUCT = 4;
const ALCOHOL_WARNING_AT = 4;

/** Spec 11.2: the basket, with the limits stated before they are hit. */
export function CartScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const format = useFormatters();
  const eventId = useCart((state) => state.eventId);
  const { products, connection } = useMarket(eventId);
  const lines = useCart((state) => state.lines);
  const setQty = useCart((state) => state.setQty);
  const clear = useCart((state) => state.clear);
  const navigate = useNavigate();

  const rows = lines.flatMap((line) => {
    const product = products.find((candidate) => candidate.id === line.productId);
    return product ? [{ line, product }] : [];
  });

  const total = rows.reduce((sum, row) => sum + row.product.priceCents * row.line.qty, 0);
  const alcoholUnits = rows
    .filter((row) => row.product.isAlcoholic)
    .reduce((sum, row) => sum + row.line.qty, 0);
  const soldOut = rows.filter((row) => row.product.stockStatus === 'SOLD_OUT');

  return (
    <>
      <AppHeader title={t('cart.title')} connection={connection} />

      <main className="mx-auto max-w-lg px-4 pb-4">
        {rows.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-muted">{t('cart.empty')}</p>
            <Button variant="secondary" className="mt-4" onClick={() => void navigate('/')}>
              {t('cart.seeMarket')}
            </Button>
          </div>
        ) : (
          <>
            <ul className="mt-3 space-y-3">
              {rows.map(({ line, product }) => (
                <li key={product.id}>
                  <Card>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{product.name}</p>
                        <p className="text-sm text-muted tabular">
                          {t('cart.each', { price: format.money(product.priceCents) })}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={t('cart.lessAria', { name: product.name })}
                          onClick={() => setQty(product.id, line.qty - 1, MAX_PER_PRODUCT)}
                          className="h-12 w-12 rounded-xl border border-line bg-raised text-xl"
                        >
                          −
                        </button>
                        <span className="w-6 text-center text-lg font-semibold tabular">
                          {line.qty}
                        </span>
                        <button
                          type="button"
                          aria-label={t('cart.moreAria', { name: product.name })}
                          disabled={
                            line.qty >= MAX_PER_PRODUCT || product.stockStatus === 'SOLD_OUT'
                          }
                          onClick={() => setQty(product.id, line.qty + 1, MAX_PER_PRODUCT)}
                          className="h-12 w-12 rounded-xl border border-line bg-raised text-xl disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <p className="mt-2 border-t border-line pt-2 text-right text-sm tabular">
                      {format.money(product.priceCents * line.qty)}
                    </p>
                  </Card>
                </li>
              ))}
            </ul>

            <div className="mt-4 space-y-2">
              {soldOut.length > 0 && (
                <Alert tone="error">
                  {t('cart.soldOut', {
                    names: soldOut.map((row) => row.product.name).join(', '),
                  })}
                </Alert>
              )}
              {/* L8: say the limit before the server has to refuse. */}
              {alcoholUnits >= ALCOHOL_WARNING_AT && (
                <Alert tone="warning">{t('cart.alcoholWarning')}</Alert>
              )}
              <p className="text-sm text-muted">
                {t('cart.maxPerProduct', { max: MAX_PER_PRODUCT })}
              </p>
            </div>

            <StickyActions>
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-muted">{t('common.total')}</span>
                <span className="text-price font-bold tabular">{format.money(total)}</span>
              </div>
              <Button
                className="w-full"
                disabled={soldOut.length > 0}
                onClick={() => void navigate('/checkout')}
              >
                {t('cart.pay')}
              </Button>
              <button
                type="button"
                onClick={clear}
                className="mt-2 min-h-12 w-full text-sm text-muted"
              >
                {t('cart.clear')}
              </button>
            </StickyActions>
          </>
        )}
      </main>
    </>
  );
}
