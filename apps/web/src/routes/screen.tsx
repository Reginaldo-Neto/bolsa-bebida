import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PriceChange } from '../components/price-change';
import { useMarket } from '../hooks/use-market';
import { formatCents } from '../lib/format';

const BANNER_MESSAGES = [
  'Leia o codigo e compre pelo telemovel',
  'Beba com moderacao. Ha agua disponivel a noite toda.',
  'Venda de bebidas alcoolicas proibida a menores de 18 anos',
];

/**
 * Spec 4.8 and 11.4: the big screen at the venue.
 *
 * Read-only and sessionless. The rule that matters most here is never showing
 * an old price as if it were current: if the stream drops, the screen says so.
 */
export function PublicScreen(): React.JSX.Element {
  const [params] = useSearchParams();
  const eventId = params.get('event');
  const { snapshot, products, connection } = useMarket(eventId);
  const [banner, setBanner] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const timer = setInterval(
      () => setBanner((index) => (index + 1) % BANNER_MESSAGES.length),
      8000,
    );
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
          Falta o evento no endereco. Use <code>/screen?event=ID</code>.
        </p>
      </main>
    );
  }

  const stale = connection !== 'live';

  return (
    <main className="flex min-h-dvh flex-col p-8">
      <header className="flex items-baseline justify-between gap-6">
        <h1 className="text-5xl font-bold">{snapshot?.eventName ?? 'Bolsa de Bebidas'}</h1>
        <p className="text-2xl text-muted tabular">
          Cotacao {snapshot?.tick ?? 0}
          {stale && <span className="ml-4 text-warning">a atualizar…</span>}
        </p>
      </header>

      <div className="mt-8 flex flex-1 gap-8">
        <table className={`flex-1 border-collapse text-3xl ${stale ? 'opacity-50' : ''}`}>
          <thead>
            <tr className="border-b border-line text-left text-xl tracking-wide text-muted uppercase">
              <th className="py-3">Bebida</th>
              <th className="py-3 text-right">Cotacao</th>
              <th className="py-3 text-right">Variacao</th>
              <th className="py-3 text-right">Minimo</th>
              <th className="py-3 text-right">Maximo</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b border-line/60">
                <td className="py-4 font-semibold">
                  {product.name}
                  {product.stockStatus === 'SOLD_OUT' && (
                    <span className="ml-3 text-xl text-down">esgotado</span>
                  )}
                </td>
                <td className="py-4 text-right text-price-lg font-bold tabular">
                  {formatCents(product.priceCents)}
                </td>
                <td className="py-4 text-right">
                  <PriceChange ratio={product.changeVsBasePct} />
                </td>
                {/* L2: the published range is on the wall, not just in the app. */}
                <td className="py-4 text-right text-muted tabular">
                  {formatCents(product.minPriceCents)}
                </td>
                <td className="py-4 text-right text-muted tabular">
                  {formatCents(product.maxPriceCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <aside className="flex w-64 flex-col items-center justify-start">
          <div className="rounded-2xl bg-white p-3">
            <canvas ref={canvasRef} aria-label="Codigo de entrada" />
          </div>
          <p className="mt-4 text-center text-xl text-muted">Aponte a camara</p>
        </aside>
      </div>

      <footer className="mt-6 border-t border-line pt-4 text-center text-2xl text-muted">
        {BANNER_MESSAGES[banner]}
      </footer>
    </main>
  );
}
