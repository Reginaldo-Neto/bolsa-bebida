import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Spinner } from '../components/ui';
import { useTranslation } from '../i18n';
import { api } from '../lib/api';
import { useFormatters } from '../lib/format';

/**
 * L2 (DL 138/90 and DL 10/2015 art. 135): the printable minimum-maximum table
 * that has to be displayed at the venue.
 *
 * Deliberately printed on white with black text and no live updates: this is a
 * document to put on a wall, not a screen to watch. themeForPath pins it light
 * so the surrounding page matches the paper.
 */
export function PricesScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const format = useFormatters();
  const [params] = useSearchParams();
  const eventId = params.get('event');

  const snapshot = useQuery({
    queryKey: ['market', eventId],
    queryFn: () => api.snapshot(eventId ?? ''),
    enabled: Boolean(eventId),
  });

  if (!eventId) {
    return (
      <main className="p-10 text-center">
        <p>{t('screen.missingEvent', { example: '/prices?event=ID' })}</p>
      </main>
    );
  }

  if (snapshot.isLoading) {
    return <Spinner label={t('prices.loading')} />;
  }

  const products = snapshot.data?.products ?? [];
  const printedAt = format.dateTime(new Date());

  return (
    <main className="mx-auto max-w-3xl bg-white p-10 text-black print:p-0">
      <h1 className="text-3xl font-bold">
        {t('prices.title', { event: snapshot.data?.eventName ?? '' })}
      </h1>
      <p className="mt-2 text-sm">{t('prices.intro')}</p>

      <table className="mt-6 w-full border-collapse text-lg">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-2">{t('prices.drink')}</th>
            <th className="py-2">{t('prices.volume')}</th>
            <th className="py-2 text-right">{t('prices.min')}</th>
            <th className="py-2 text-right">{t('prices.max')}</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border-b border-neutral-300">
              <td className="py-2">
                {product.name}
                {!product.isAlcoholic && t('prices.noAlcoholSuffix')}
              </td>
              <td className="py-2">{format.volume(product.volumeMl) || '—'}</td>
              <td className="py-2 text-right tabular">{format.money(product.minPriceCents)}</td>
              <td className="py-2 text-right tabular">{format.money(product.maxPriceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-8 text-sm">{t('prices.legal')}</p>
      <p className="mt-1 text-xs text-neutral-600">{t('prices.printedAt', { when: printedAt })}</p>

      <button
        type="button"
        onClick={() => window.print()}
        className="mt-6 rounded-lg border-2 border-black px-5 py-2 print:hidden"
      >
        {t('prices.print')}
      </button>
    </main>
  );
}
