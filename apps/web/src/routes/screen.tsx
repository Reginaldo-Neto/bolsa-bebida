import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PriceChange } from '../components/price-change';
import { useMarket } from '../hooks/use-market';
import { useTranslation, type TranslationKey } from '../i18n';
import { api } from '../lib/api';
import { useFormatters } from '../lib/format';

const BANNER_KEYS: TranslationKey[] = ['screen.banner1', 'screen.banner2', 'screen.banner3'];

/**
 * Spec 4.8 and 11.4: the big screen at the venue.
 *
 * Read-only and sessionless. The rule that matters most here is never showing
 * an old price as if it were current: if the stream drops, the screen says so.
 * The theme is pinned dark in themeForPath: this is a projector in a dark room,
 * not somebody's phone.
 */
export function PublicScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const format = useFormatters();
  const [params] = useSearchParams();
  const eventId = params.get('event');
  const { snapshot, products, connection } = useMarket(eventId);
  const [banner, setBanner] = useState(0);

  // Spec 4.8: the top five, optional and opt-in only.
  const leaderboard = useQuery({
    queryKey: ['public-leaderboard', eventId],
    queryFn: () => api.publicLeaderboard(eventId ?? ''),
    enabled: Boolean(eventId),
    refetchInterval: 30_000,
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setBanner((index) => (index + 1) % BANNER_KEYS.length), 8000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!eventId || !canvasRef.current) {
      return;
    }
    const joinUrl = `${window.location.origin}/e/${eventId}`;
    void QRCode.toCanvas(canvasRef.current, joinUrl, {
      width: 220,
      margin: 1,
      color: { dark: '#000000', light: '#ffffff' },
    });
  }, [eventId]);

  if (!eventId) {
    return (
      <main className="grid min-h-dvh place-items-center p-10 text-center">
        <p className="text-2xl text-muted">
          {t('screen.missingEvent', { example: '/screen?event=ID' })}
        </p>
      </main>
    );
  }

  const stale = connection !== 'live';
  const bannerKey = BANNER_KEYS[banner] ?? BANNER_KEYS[0]!;

  return (
    <main className="flex min-h-dvh flex-col p-8">
      <header className="flex items-baseline justify-between gap-6">
        <h1 className="text-5xl font-bold">{snapshot?.eventName ?? 'Bolsa de Bebidas'}</h1>
        <p className="text-2xl text-muted tabular">
          {t('screen.tick', { tick: snapshot?.tick ?? 0 })}
          {stale && <span className="ml-4 text-warning">{t('screen.updating')}</span>}
        </p>
      </header>

      <div className="mt-8 flex flex-1 gap-8">
        <table className={`flex-1 border-collapse text-3xl ${stale ? 'opacity-50' : ''}`}>
          <thead>
            <tr className="border-b border-line text-left text-xl tracking-wide text-muted uppercase">
              <th className="py-3">{t('screen.drink')}</th>
              <th className="py-3 text-right">{t('screen.quote')}</th>
              <th className="py-3 text-right">{t('screen.change')}</th>
              <th className="py-3 text-right">{t('screen.min')}</th>
              <th className="py-3 text-right">{t('screen.max')}</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b border-line/60">
                <td className="py-4 font-semibold">
                  {product.name}
                  {product.stockStatus === 'SOLD_OUT' && (
                    <span className="ml-3 text-xl text-down">{t('screen.soldOut')}</span>
                  )}
                </td>
                <td className="py-4 text-right text-price-lg font-bold tabular">
                  {format.money(product.priceCents)}
                </td>
                <td className="py-4 text-right">
                  <PriceChange ratio={product.changeVsBasePct} />
                </td>
                {/* L2: the published range is on the wall, not just in the app. */}
                <td className="py-4 text-right text-muted tabular">
                  {format.money(product.minPriceCents)}
                </td>
                <td className="py-4 text-right text-muted tabular">
                  {format.money(product.maxPriceCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <aside className="flex w-72 flex-col items-center justify-start">
          <div className="rounded-2xl bg-white p-3">
            <canvas ref={canvasRef} aria-label={t('screen.entryAria')} />
          </div>
          <p className="mt-4 text-center text-xl text-muted">{t('screen.pointCamera')}</p>

          {(leaderboard.data?.entries.length ?? 0) > 0 && (
            <div className="mt-8 w-full">
              <h2 className="mb-3 text-center text-xl tracking-wide text-muted uppercase">
                {t('ranking.title')}
              </h2>
              <ol className="space-y-2">
                {leaderboard.data?.entries.slice(0, 5).map((entry) => (
                  <li key={entry.participantId} className="flex items-baseline gap-3 text-2xl">
                    <span className="w-6 text-muted tabular">{entry.position}</span>
                    <span className="min-w-0 flex-1 truncate">{entry.nickname}</span>
                    <span className="tabular text-up">{entry.points}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </div>

      <footer className="mt-6 border-t border-line pt-4 text-center text-2xl text-muted">
        {t(bannerKey)}
      </footer>
    </main>
  );
}
