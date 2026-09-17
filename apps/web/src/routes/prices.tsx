import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatCents } from '../lib/format';

/**
 * L2 (DL 138/90 and DL 10/2015 art. 135): the printable minimum-maximum table
 * that has to be displayed at the venue.
 *
 * Deliberately printed on white with black text and no live updates: this is a
 * document to put on a wall, not a screen to watch.
 */
export function PricesScreen(): React.JSX.Element {
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
        <p>
          Falta o evento no endereco. Use <code>/prices?event=ID</code>.
        </p>
      </main>
    );
  }

  if (snapshot.isLoading) {
    return <Spinner label="A carregar a tabela de precos" />;
  }

  const products = snapshot.data?.products ?? [];
  const printedAt = new Date().toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' });

  return (
    <main className="mx-auto max-w-3xl bg-white p-10 text-black print:p-0">
      <h1 className="text-3xl font-bold">Tabela de precos — {snapshot.data?.eventName}</h1>
      <p className="mt-2 text-sm">
        Os precos variam ao longo do evento conforme a procura, sempre dentro do intervalo minimo e
        maximo indicado para cada bebida. O preco apresentado no momento da compra fica bloqueado
        ate a confirmacao do pagamento.
      </p>

      <table className="mt-6 w-full border-collapse text-lg">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="py-2">Bebida</th>
            <th className="py-2">Volume</th>
            <th className="py-2 text-right">Minimo</th>
            <th className="py-2 text-right">Maximo</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border-b border-neutral-300">
              <td className="py-2">
                {product.name}
                {!product.isAlcoholic && ' (sem alcool)'}
              </td>
              <td className="py-2">{product.volumeMl ? `${product.volumeMl} ml` : '—'}</td>
              <td className="py-2 text-right tabular">{formatCents(product.minPriceCents)}</td>
              <td className="py-2 text-right tabular">{formatCents(product.maxPriceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-8 text-sm">
        Venda de bebidas alcoolicas proibida a menores de 18 anos. Beba com moderacao.
      </p>
      <p className="mt-1 text-xs text-neutral-600">Tabela impressa em {printedAt}.</p>

      <button
        type="button"
        onClick={() => window.print()}
        className="mt-6 rounded-lg border-2 border-black px-5 py-2 print:hidden"
      >
        Imprimir
      </button>
    </main>
  );
}
