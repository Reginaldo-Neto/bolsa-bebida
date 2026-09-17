import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppHeader } from '../components/chrome';
import { Alert, Button, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatCents } from '../lib/format';

/**
 * Spec 11.2: waiting for MB WAY.
 *
 * The socket push is the fast path; the poll is the safety net, because venue
 * wifi drops and a participant staring at a spinner that never resolves is the
 * failure they will remember.
 */
export function PaymentScreen(): React.JSX.Element {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();

  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: api.myOrders,
    refetchInterval: (query) => {
      const order = query.state.data?.find((candidate) => candidate.id === orderId);
      return order && order.status !== 'PENDING' ? false : 3_000;
    },
  });

  const order = orders.data?.find((candidate) => candidate.id === orderId);

  useEffect(() => {
    if (order?.voucher) {
      void navigate(`/vouchers/${order.voucher.id}`, { replace: true });
    }
  }, [order, navigate]);

  if (orders.isLoading || !order) {
    return <Spinner label="A confirmar o pagamento" />;
  }

  if (order.status === 'FAILED' || order.status === 'EXPIRED') {
    return (
      <>
        <AppHeader title="Pagamento" />
        <main className="mx-auto max-w-lg px-4 py-6">
          <Alert tone="error">
            {order.status === 'EXPIRED'
              ? 'O pagamento demorou demasiado tempo e a reserva foi libertada.'
              : 'O pagamento foi recusado.'}
          </Alert>
          <p className="mt-3 text-sm text-muted">
            As bebidas voltaram ao mercado. Pode tentar de novo aos precos atuais.
          </p>
          <Button className="mt-6 w-full" onClick={() => void navigate('/')}>
            Voltar ao mercado
          </Button>
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader title="Pagamento" />
      <main className="mx-auto max-w-lg px-4 py-10 text-center">
        <div
          aria-hidden="true"
          className="mx-auto h-16 w-16 animate-spin rounded-full border-4 border-line border-t-accent"
        />
        <h2 className="mt-6 text-xl font-semibold">Confirme na aplicacao MB WAY</h2>
        <p className="mt-2 text-muted">
          Enviamos um pedido de {formatCents(order.totalCents)} para o seu telemovel. Assim que
          confirmar, o voucher aparece aqui.
        </p>

        <ul className="mt-6 space-y-1 text-sm text-muted">
          {order.items.map((item) => (
            <li key={item.id}>
              {item.qty}× {item.name}
            </li>
          ))}
        </ul>

        <Button variant="ghost" className="mt-8 w-full" onClick={() => void navigate('/')}>
          Continuar a ver o mercado
        </Button>

        {import.meta.env.DEV && order.paymentRef && (
          <DevPaymentControls paymentRef={order.paymentRef} />
        )}
      </main>
    </>
  );
}

/**
 * Development only: there is no MB WAY application to confirm in, so this does
 * what the gateway's webhook would do. The API refuses these routes outside
 * development, and this block is stripped from a production build.
 */
function DevPaymentControls({ paymentRef }: { paymentRef: string }): React.JSX.Element {
  const queryClient = useQueryClient();

  const simulate = useMutation({
    mutationFn: (status: 'PAID' | 'FAILED') => api.simulatePayment(paymentRef, status),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  return (
    <section className="mt-10 rounded-xl border border-dashed border-line p-4 text-left">
      <p className="text-xs tracking-wide text-muted uppercase">Apenas em desenvolvimento</p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="secondary"
          className="flex-1"
          disabled={simulate.isPending}
          onClick={() => simulate.mutate('PAID')}
        >
          Confirmar pagamento
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          disabled={simulate.isPending}
          onClick={() => simulate.mutate('FAILED')}
        >
          Recusar
        </Button>
      </div>
    </section>
  );
}
